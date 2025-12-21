import { defineHook } from '@directus/extensions-sdk';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import {Resend} from "resend";

export default defineHook(({ init }, { env, database, services, logger, getSchema }) => {
    init('middlewares.before', ({ app }) => {
        const webhookPath = (env.STRIPE_WEBHOOK_PATH || '/ca-stripe-webho').replace(/\/$/, '');

        app.post(
            webhookPath,
            bodyParser.raw({ type: 'application/json' }),
            async (req, res) => {

                const stripeSignature = req.headers['stripe-signature'];
                const rawBody = req.body;

                if (!stripeSignature || !rawBody) {
                    return res.status(400).send('Missing Stripe signature or body');
                }

                logger.info('=== STRIPE WEBHOOK RECEIVED ===');
                logger.info(`Path: ${req.path}`);
                logger.info(`Method: ${req.method}`);
                logger.info(`Has signature: ${!!stripeSignature}`);
                logger.info(`Raw body length: ${rawBody?.length || 0}`);
                logger.info('Processing Stripe webhook...');

                try {
                    await handleStripeWebhook(req, res, rawBody, stripeSignature);
                } catch (err) {
                    logger.error('❌ Stripe webhook error:', err.message);
                    res.status(err.status || 500).json({ error: err.message });
                }
            }
        );
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
            throw { message: `Webhook signature verification failed`, status: 400 };
            // event = JSON.parse(rawBody);
        }

        // Process the webhook event
        const schema = await getSchema({ database });
        const { ItemsService, UsersService } = services;
        const transactionsService = new ItemsService('transactions', {
            knex: database,
            schema
        });
        const subscriptionsService = new ItemsService('user_subscriptions', {
            knex: database,
            schema
        });
        const usersService = new UsersService({
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

                    const resolvedUserId = transaction.user_created || session.metadata?.user_id;
                    if (!resolvedUserId) {
                        logger.error('❌ Unable to resolve user for transaction', {
                            transaction_id: transaction.id,
                            session_id: session.id
                        });
                        throw new Error('User could not be resolved for subscription');
                    }

                    let user;
                    try {
                        user = await usersService.readOne(resolvedUserId, {
                            fields: ['id', 'email', 'first_name', 'last_name', 'subscription_status', 'subscription_expiry', 'subscription_start']
                        });
                    } catch (err) {
                        logger.error('❌ Failed to fetch user for subscription', {
                            user_id: resolvedUserId,
                            error: err.message
                        });
                        throw err;
                    }

                    const userEmail = user.email;
                    const periodStart = new Date();
                    const periodEnd = new Date(periodStart);
                    const billingPeriod = session?.metadata?.billing_period;

                    if (billingPeriod === 'yearly') {
                        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
                    } else if (billingPeriod === 'monthly') {
                        periodEnd.setMonth(periodEnd.getMonth() + 1);
                    } else {
                        logger.warn(`⚠️ Unknown billing_period: ${billingPeriod}, defaulting to monthly`);
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
                        billing_period: billingPeriod,
                        cancel_at_period_end: false,
                    };

                    let subscriptionModel;

                    if (existingSubscriptions.length > 0) {
                        subscriptionModel = await subscriptionsService.updateOne(existingSubscriptions[0].id, subscriptionData);
                        logger.info(`✅ Subscription updated: ${existingSubscriptions[0].id}`);
                    } else {
                        subscriptionModel = await subscriptionsService.createOne(subscriptionData);
                        logger.info(`✅ New subscription created: ${subscriptionModel.id}`);
                    }

                    await usersService.updateOne(user.id, {
                        subscription_status: 'active',
                        subscription_start: periodStart,
                        subscription_expiry: periodEnd,
                        active_subscription: subscriptionModel.id,
                    });

                    await transactionsService.updateOne(transaction.id, transactionUpdate);
                    logger.info(`✅ Transaction updated: ${transaction.id} - Status: completed`);
                    logger.info(`Subscription period: ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

                    const subscriptionType = 'News Subscription';
                    const billingPeriodFormatted = billingPeriod === 'yearly' ? 'Yearly' : 'Monthly';

                    const expiryDateFormatted = periodEnd.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                    const startDateFormatted = periodStart.toLocaleDateString('en-GB', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                    });

                    const amountPaid = `${session.currency.toUpperCase()} ${(session.amount_total / 100).toFixed(2)}`;

                    const resend = new Resend(env.EMAIL_SMTP_PASSWORD);
                    try {
                        const { data, error } = await resend.emails.send({
                            from: env.EMAIL_FROM,
                            to: userEmail,
                            subject: 'Payment Successful – News Subscription Activated',
                            html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #111827;">Payment Successful</h2>

            <p>Hi ${user.first_name},</p>

            <p>
                Thank you for your payment! Your <strong>${subscriptionType}</strong>
                has been successfully activated.
            </p>

            <hr style="margin: 24px 0;" />

            <h3 style="margin-bottom: 8px;">Subscription Details</h3>

            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0;"><strong>Plan</strong></td>
                    <td style="padding: 8px 0;">${subscriptionType}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Billing Period</strong></td>
                    <td style="padding: 8px 0;">${billingPeriodFormatted}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Start Date</strong></td>
                    <td style="padding: 8px 0;">${startDateFormatted}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Expiry Date</strong></td>
                    <td style="padding: 8px 0;">${expiryDateFormatted}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0;"><strong>Amount Paid</strong></td>
                    <td style="padding: 8px 0;">${amountPaid}</td>
                </tr>
            </table>

            <hr style="margin: 24px 0;" />

            <p>
                You now have full access to your news subscription benefits.
                If you have any questions or need help, our support team is always here for you.
            </p>

            <p style="margin-top: 24px;">
                <a
                    href="${env.FRONTEND_URL}/dashboard"
                    style="
                        display: inline-block;
                        padding: 12px 20px;
                        background-color: #111827;
                        color: #ffffff;
                        text-decoration: none;
                        border-radius: 6px;
                        font-weight: bold;
                    "
                >
                    Go to Dashboard
                </a>
            </p>

            <p style="margin-top: 32px; font-size: 12px; color: #6b7280;">
                If you did not authorize this payment, please contact support immediately.
            </p>
        </div>
    `
                        });

                        if (error) {
                            logger.error('❌ Resend API error details:', {
                                message: error.message,
                                name: error.name,
                                statusCode: error.statusCode,
                                fullError: JSON.stringify(error, null, 2)
                            });
                            throw error;
                        }

                        logger.info(`✅email sent successfully! Email ID: ${data.id}`);

                    } catch (emailError) {
                        logger.error('❌ Email sending failed:', {
                            message: emailError.message,
                            stack: emailError.stack,
                            fullError: JSON.stringify(emailError, null, 2)
                        });

                        return res.status(500).json({
                            success: false,
                            message: 'Registration successful but email verification could not be sent. Please contact support.',
                            debug: emailError.message // Remove this in production
                        });
                    }
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