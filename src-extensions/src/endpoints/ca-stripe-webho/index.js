import { Stripe } from "stripe";

export default (router, { services, exceptions, env, logger, getSchema }) => {
    const { ItemsService } = services
    const { ServiceUnavailableException } = exceptions
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    const endpointSecret = env.STRIPE_WEBHOOK_SECRET

    router.post('/', async (req, res) => {
        // MAIN DIFFERENCE WITH STRIPE EXAMPLE
        let event = req.rawBody
        // Only verify the event if you have an endpoint secret defined.
        // Otherwise use the basic event deserialized with JSON.parse
        if (endpointSecret) {
            // Get the signature sent by Stripe
            const signature = req.headers['stripe-signature']
            try {
                event = stripe.webhooks.constructEvent(
                    req.rawBody,
                    signature,
                    endpointSecret
                )
            } catch (err) {
                console.log(`⚠️  Webhook signature verification failed.`, err.message)
                return res.sendStatus(400)
            }
        }

        const schema = await getSchema();
        const transactionsService = new ItemsService("transactions", { schema });

        try {
            switch (event.type) {
                case "checkout.session.completed": {
                    const session = event.data.object;

                    // Find transaction by session ID
                    const transactions = await transactionsService.readByQuery({
                        filter: { stripe_session_id: { _eq: session.id } },
                        limit: 1,
                    });

                    if (transactions.length === 0) {
                        logger.warn(`Transaction not found for session: ${session.id}`);
                        break;
                    }

                    const updateData = {
                        // stripe_customer_id: session.customer,
                        provider_reference: session.payment_intent,
                        status: "completed",
                        completed_at: new Date(),
                    };

                    // Handle subscription
                    updateData.subscription_status = "active";

                    updateData.subscription_period_start = new Date();
                    updateData.subscription_period_end = new Date();
                    updateData.amount = session.amount_total / 100;
                    updateData.currency = session.currency;

                    await transactionsService.updateOne(transactions[0].id, updateData);
                    logger.info(
                        `Transaction updated: ${transactions[0].id} - Status: completed`,
                    );
                    break;
                }

                case "payment_intent.succeeded": {
                    const paymentIntent = event.data.object;

                    const transactions = await transactionsService.readByQuery({
                        filter: { provider_reference: { _eq: paymentIntent.id } },
                        limit: 1,
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            status: "completed",
                            completed_at: new Date(),
                        });
                        logger.info(
                            `Payment succeeded for transaction: ${transactions[0].id}`,
                        );
                    }
                    break;
                }

                case "payment_intent.payment_failed": {
                    const paymentIntent = event.data.object;

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
                        logger.info(
                            `Payment failed for transaction: ${transactions[0].id}`,
                        );
                    }
                    break;
                }

                default:
                    logger.info(`Unhandled event type: ${event.type}`);
            }

            res.json({ received: true });
        } catch (error) {
            logger.error("Webhook processing error:", error);
            res.status(500).json({ error: "Webhook processing failed" });
        }
    })
}