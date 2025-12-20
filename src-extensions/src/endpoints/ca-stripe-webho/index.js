import { Stripe } from "stripe";
import express from "express";

export default (router, { services, exceptions, env, logger, getSchema }) => {
    const { ItemsService } = services
    const { ServiceUnavailableException } = exceptions
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const endpointSecret = env.STRIPE_WEBHOOK_SECRET

    router.post('/', express.raw({ type: 'application/json' }), async (req, res) => {
        // TROUBLESHOOTING: Log incoming request details
        logger.info('=== STRIPE WEBHOOK RECEIVED ===');
        logger.info(`Headers: ${JSON.stringify(req.headers)}`);
        logger.info(`Content-Type: ${req.headers['content-type']}`);
        logger.info(`Has stripe-signature: ${!!req.headers['stripe-signature']}`);

        // TROUBLESHOOTING: Check body formats
        logger.info(`Body type: ${typeof req.body}`);
        logger.info(`Has rawBody: ${!!req.rawBody}`);
        logger.info(`Body is Buffer: ${Buffer.isBuffer(req.body)}`);
        logger.info(`RawBody is Buffer: ${Buffer.isBuffer(req.rawBody)}`);

        let event;

        // Only verify the event if you have an endpoint secret defined.
        if (endpointSecret) {
            const signature = req.headers['stripe-signature'];

            // TROUBLESHOOTING: Validate prerequisites
            if (!signature) {
                logger.error('❌ Missing stripe-signature header');
                return res.status(400).json({ error: 'Missing stripe-signature header' });
            }

            // TROUBLESHOOTING: Try different body sources
            const bodyToUse = req.rawBody || req.body;

            if (!bodyToUse) {
                logger.error('❌ Missing request body (both req.body and req.rawBody are empty)');
                return res.status(400).json({ error: 'Missing request body' });
            }

            logger.info(`Using body source: ${req.rawBody ? 'req.rawBody' : 'req.body'}`);
            logger.info(`Body length: ${bodyToUse.length || bodyToUse.byteLength || 0}`);

            try {
                event = stripe.webhooks.constructEvent(
                    bodyToUse,
                    signature,
                    endpointSecret
                );
                logger.info('✅ Webhook signature verified successfully');
                logger.info(`Event type: ${event.type}`);
            } catch (err) {
                logger.error('❌ Webhook signature verification failed');
                logger.error(`Error name: ${err.name}`);
                logger.error(`Error message: ${err.message}`);
                logger.error(`Signature header: ${signature}`);
                logger.error(`Endpoint secret configured: ${endpointSecret ? 'Yes (length: ' + endpointSecret.length + ')' : 'No'}`);

                // TROUBLESHOOTING: Additional signature debugging
                if (err.message.includes('timestamp')) {
                    logger.error('⚠️ Timestamp issue - check server clock sync');
                } else if (err.message.includes('signature')) {
                    logger.error('⚠️ Signature mismatch - verify endpoint secret matches Stripe dashboard');
                }

                return res.status(400).json({
                    error: 'Webhook signature verification failed',
                    message: err.message
                });
            }
        } else {
            // TROUBLESHOOTING: Warn if running without signature verification
            logger.warn('⚠️ Running webhook WITHOUT signature verification (no endpoint secret configured)');

            try {
                // Parse the body as JSON if no signature verification
                const bodyToUse = req.rawBody || req.body;
                event = JSON.parse(bodyToUse.toString());
                logger.info(`Event type (unverified): ${event.type}`);
            } catch (err) {
                logger.error('❌ Failed to parse webhook body as JSON');
                logger.error(`Error: ${err.message}`);
                return res.status(400).json({ error: 'Invalid JSON body' });
            }
        }

        // TROUBLESHOOTING: Log event processing start
        logger.info(`Processing event: ${event.type} (ID: ${event.id})`);

        const schema = await getSchema();
        const transactionsService = new ItemsService("transactions", { schema });

        try {
            switch (event.type) {
                case "checkout.session.completed": {
                    const session = event.data.object;
                    logger.info(`Processing checkout.session.completed: ${session.id}`);

                    // Find transaction by session ID
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
                    logger.info(`✅ Transaction updated: ${transactions[0].id} - Status: completed`);
                    break;
                }

                case "payment_intent.succeeded": {
                    const paymentIntent = event.data.object;
                    logger.info(`Processing payment_intent.succeeded: ${paymentIntent.id}`);

                    const transactions = await transactionsService.readByQuery({
                        filter: { provider_reference: { _eq: paymentIntent.id } },
                        limit: 1,
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            status: "completed",
                            completed_at: new Date(),
                        });
                        logger.info(`✅ Payment succeeded for transaction: ${transactions[0].id}`);
                    } else {
                        logger.warn(`⚠️ No transaction found for payment_intent: ${paymentIntent.id}`);
                    }
                    break;
                }

                case "payment_intent.payment_failed": {
                    const paymentIntent = event.data.object;
                    logger.info(`Processing payment_intent.payment_failed: ${paymentIntent.id}`);

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
                        logger.info(`✅ Payment failed recorded for transaction: ${transactions[0].id}`);
                    } else {
                        logger.warn(`⚠️ No transaction found for failed payment_intent: ${paymentIntent.id}`);
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
            logger.error(`Error name: ${error.name}`);
            logger.error(`Error message: ${error.message}`);
            logger.error(`Stack trace: ${error.stack}`);
            res.status(500).json({ error: "Webhook processing failed" });
        }
    })
}