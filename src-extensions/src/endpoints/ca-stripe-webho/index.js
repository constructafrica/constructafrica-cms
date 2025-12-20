import { Stripe } from "stripe";

export default (router, { services, exceptions, env, logger, getSchema }) => {
    const { ItemsService } = services;
    const { ServiceUnavailableException } = exceptions;
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const endpointSecret = env.STRIPE_WEBHOOK_SECRET;

    // CRITICAL FIX: Register middleware to capture raw body BEFORE Directus parses it
    router.post('/',
        (req, res, next) => {
            // Capture the raw body as it comes in
            let data = '';

            req.setEncoding('utf8');
            req.on('data', chunk => {
                data += chunk;
            });

            req.on('end', () => {
                req.rawBody = data;
                next();
            });
        },
        async (req, res) => {
            // TROUBLESHOOTING: Log incoming request details
            logger.info('=== STRIPE WEBHOOK RECEIVED ===');
            logger.info(`Content-Type: ${req.headers['content-type']}`);
            logger.info(`Has stripe-signature: ${!!req.headers['stripe-signature']}`);
            logger.info(`Has rawBody: ${!!req.rawBody}`);
            logger.info(`RawBody length: ${req.rawBody?.length || 0}`);

            let event;

            if (endpointSecret) {
                const signature = req.headers['stripe-signature'];

                if (!signature) {
                    logger.error('❌ Missing stripe-signature header');
                    return res.status(400).json({ error: 'Missing stripe-signature header' });
                }

                if (!req.rawBody) {
                    logger.error('❌ Missing raw body');
                    return res.status(400).json({ error: 'Missing request body' });
                }

                try {
                    event = stripe.webhooks.constructEvent(
                        req.rawBody,
                        signature,
                        endpointSecret
                    );
                    logger.info(`✅ Webhook signature verified - Event type: ${event.type}`);
                } catch (err) {
                    logger.error('❌ Webhook signature verification failed');
                    logger.error(`Error: ${err.message}`);

                    if (err.message.includes('timestamp')) {
                        logger.error('⚠️ Timestamp issue - check server clock sync (tolerance: 5min)');
                    } else if (err.message.includes('signature')) {
                        logger.error('⚠️ Signature mismatch - verify endpoint secret matches Stripe dashboard');
                        logger.error(`Secret length: ${endpointSecret?.length || 0}`);
                    }

                    return res.status(400).json({
                        error: 'Webhook signature verification failed',
                        message: err.message
                    });
                }
            } else {
                logger.warn('⚠️ Running WITHOUT signature verification - INSECURE!');
                try {
                    event = JSON.parse(req.rawBody);
                } catch (err) {
                    logger.error('❌ Failed to parse JSON');
                    return res.status(400).json({ error: 'Invalid JSON' });
                }
            }

            logger.info(`Processing event: ${event.type} (ID: ${event.id})`);

            const schema = await getSchema();
            const transactionsService = new ItemsService("transactions", { schema });

            try {
                switch (event.type) {
                    case "checkout.session.completed": {
                        const session = event.data.object;
                        logger.info(`checkout.session.completed: ${session.id}`);

                        const transactions = await transactionsService.readByQuery({
                            filter: { stripe_session_id: { _eq: session.id } },
                            limit: 1,
                        });

                        if (transactions.length === 0) {
                            logger.warn(`❌ Transaction not found for session: ${session.id}`);
                            break;
                        }

                        const updateData = {
                            provider_reference: session.payment_intent,
                            status: "completed",
                            completed_at: new Date(),
                            subscription_status: "active",
                            subscription_period_start: new Date(),
                            subscription_period_end: new Date(),
                            amount: session.amount_total / 100,
                            currency: session.currency,
                        };

                        await transactionsService.updateOne(transactions[0].id, updateData);
                        logger.info(`✅ Transaction updated: ${transactions[0].id}`);
                        break;
                    }

                    case "payment_intent.succeeded": {
                        const paymentIntent = event.data.object;
                        logger.info(`payment_intent.succeeded: ${paymentIntent.id}`);

                        const transactions = await transactionsService.readByQuery({
                            filter: { provider_reference: { _eq: paymentIntent.id } },
                            limit: 1,
                        });

                        if (transactions.length > 0) {
                            await transactionsService.updateOne(transactions[0].id, {
                                status: "completed",
                                completed_at: new Date(),
                            });
                            logger.info(`✅ Payment succeeded: ${transactions[0].id}`);
                        } else {
                            logger.warn(`⚠️ No transaction for payment_intent: ${paymentIntent.id}`);
                        }
                        break;
                    }

                    case "payment_intent.payment_failed": {
                        const paymentIntent = event.data.object;
                        logger.info(`payment_intent.payment_failed: ${paymentIntent.id}`);

                        const transactions = await transactionsService.readByQuery({
                            filter: { provider_reference: { _eq: paymentIntent.id } },
                            limit: 1,
                        });

                        if (transactions.length > 0) {
                            await transactionsService.updateOne(transactions[0].id, {
                                status: "failed",
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
                res.json({ received: true });
            } catch (error) {
                logger.error("❌ Webhook processing error:");
                logger.error(`Name: ${error.name}`);
                logger.error(`Message: ${error.message}`);
                logger.error(`Stack: ${error.stack}`);
                res.status(500).json({ error: "Webhook processing failed" });
            }
        }
    );
}