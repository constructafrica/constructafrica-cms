import { defineHook } from '@directus/extensions-sdk';
import bodyParser from 'body-parser';
import Stripe from 'stripe';

export default defineHook(({ init }, { env, database, services, logger, getSchema }) => {
    init('middlewares.before', ({ app }) => {
        app.use((req, res, next) => {
            let stripeSignature;
            let rawBody;

            // Use bodyParser with verify callback to capture raw body
            bodyParser.json({
                verify: (req, _res, buf) => {
                    stripeSignature = req.get('stripe-signature');
                    if (stripeSignature) {
                        rawBody = buf.toString();
                    }
                }
            })(req, res, async () => {
                // Only process if this is a Stripe webhook
                if (!(stripeSignature && rawBody)) {
                    return next();
                }

                // Check if this is our webhook path
                const webhookPath = env.STRIPE_WEBHOOK_PATH || '/ca-stripe-webho';

                // Normalize paths for comparison (remove trailing slashes)
                const normalizedReqPath = req.path.replace(/\/$/, '');
                const normalizedWebhookPath = webhookPath.replace(/\/$/, '');

                if (normalizedReqPath !== normalizedWebhookPath) {
                    return next();
                }

                logger.info('=== STRIPE WEBHOOK RECEIVED ===');
                logger.info(`Path: ${req.path}`);
                logger.info(`Method: ${req.method}`);
                logger.info(`Has signature: ${!!stripeSignature}`);
                logger.info(`Raw body length: ${rawBody?.length || 0}`);
                logger.info('Processing Stripe webhook...');

                try {
                    await handleStripeWebhook(req, res, rawBody, stripeSignature);
                    // DON'T call next() - response is already sent in handleStripeWebhook
                } catch (error) {
                    logger.error('❌ Stripe webhook error:', error.message);
                    return res.status(error.status || 500).json({
                        error: error.message,
                    });
                }
            });
        });
    });

    async function handleStripeWebhook(req, res, rawBody, stripeSignature) {
        const stripeSecretKey = env.STRIPE_SECRET_KEY;
        const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

        if (!stripeSecretKey) {
            logger.error('❌ STRIPE_SECRET_KEY not configured');
            throw { message: 'Stripe secret key is not set', status: 500 };
        }

        const stripe = new Stripe(stripeSecretKey);
        let event;

        // Verify signature
        if (endpointSecret) {
            try {
                event = stripe.webhooks.constructEvent(
                    rawBody,
                    stripeSignature,
                    endpointSecret
                );
                logger.info(`✅ Signature verified - Event: ${event.type}`);
            } catch (err) {
                logger.error('❌ Signature verification failed:', err.message);
                throw { message: `Webhook signature verification failed: ${err.message}`, status: 400 };
            }
        } else {
            logger.warn('⚠️ No STRIPE_WEBHOOK_SECRET - signature verification disabled');
            event = JSON.parse(rawBody);
        }

        // Process the webhook event
        const schema = await getSchema({ database });
        const { ItemsService } = services;
        const transactionsService = new ItemsService('transactions', {
            knex: database,
            schema
        });
        const subscriptionsService = new ItemsService('user_subscriptions', {
            knex: database,
            schema
        });

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    logger.info(`Processing checkout.session.completed: ${session.id}`);

                    const transactions = await transactionsService.readByQuery({
                        filter: { reference: { _eq: session.id } },
                        limit: 1,
                    });

                    if (transactions.length === 0) {
                        logger.warn(`❌ Transaction not found for session: ${session.id}`);
                        break;
                    }

                    const transaction = transactions[0];
                    const periodStart = new Date();
                    const periodEnd = new Date(periodStart);

                    if (transaction.billing_period === 'yearly') {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                    } else if (transaction.billing_period === 'monthly') {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    } else {
                        logger.warn(`⚠️ Unknown billing_period: ${transaction.billing_period}, defaulting to monthly`);
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    }

                    const transactionUpdate = {
                        provider_reference: session.payment_intent,
                        status: 'completed',
                        completed_at: new Date(),
                        amount: session.amount_total / 100,
                        currency: session.currency,
                    };

                    // Create or update user_subscriptions record
                    const existingSubscriptions = await subscriptionsService.readByQuery({
                        filter: { status: { _eq: 'active' }, user: { _eq: transaction.user_created } },
                        limit: 1,
                    });

                    const subscriptionData = {
                        user: transaction.user_created,
                        plan: transaction.payable_id,
                        status: 'active',
                        start_date: periodStart,
                        end_date: periodEnd,
                        billing_period: session.metadata.billing_period,
                        cancel_at_period_end: false,
                    };

                    if (existingSubscriptions.length > 0) {
                        await subscriptionsService.updateOne(existingSubscriptions[0].id, subscriptionData);
                        logger.info(`✅ Subscription updated: ${existingSubscriptions[0].id}`);
                    } else {
                        const newSub = await subscriptionsService.createOne(subscriptionData);
                        logger.info(`✅ New subscription created: ${newSub.id}`);
                    }

                    await transactionsService.updateOne(transaction.id, transactionUpdate);
                    logger.info(`✅ Transaction updated: ${transaction.id} - Status: completed`);
                    logger.info(`Subscription period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);
                    break;
                }

                // case 'payment_intent.succeeded': {
                //     const paymentIntent = event.data.object;
                //     logger.info(`Processing payment_intent.succeeded: ${paymentIntent.id}`);
                //
                //     const transactions = await transactionsService.readByQuery({
                //         filter: { provider_reference: { _eq: paymentIntent.id } },
                //         limit: 1,
                //     });
                //
                //     if (transactions.length > 0) {
                //         await transactionsService.updateOne(transactions[0].id, {
                //             status: 'completed',
                //             completed_at: new Date(),
                //         });
                //         logger.info(`✅ Payment succeeded: ${transactions[0].id}`);
                //     } else {
                //         logger.warn(`⚠️ No transaction for payment_intent: ${paymentIntent.id}`);
                //     }
                //     break;
                // }

                case 'payment_intent.payment_failed': {
                    const paymentIntent = event.data.object;
                    logger.info(`Processing payment_intent.payment_failed: ${paymentIntent.id}`);

                    const transactions = await transactionsService.readByQuery({
                        filter: { provider_reference: { _eq: paymentIntent.id } },
                        limit: 1,
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            status: 'failed',
                            metadata: {
                                ...transactions[0].metadata,
                                failure_message: paymentIntent.last_payment_error?.message,
                            },
                        });
                        logger.info(`✅ Payment failure recorded: ${transactions[0].id}`);
                    } else {
                        logger.warn(`⚠️ No transaction for failed payment: ${paymentIntent.id}`);
                    }
                    break;
                }

                default:
                    logger.info(`ℹ️ Unhandled event type: ${event.type}`);
            }

            logger.info('✅ Webhook processed successfully');
            res.status(200).json({ received: true });
            logger.info('Response sent to Stripe');
        } catch (error) {
            logger.error('❌ Webhook processing error:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
            throw { message: 'Webhook processing failed', status: 500 };
        }
    }
});