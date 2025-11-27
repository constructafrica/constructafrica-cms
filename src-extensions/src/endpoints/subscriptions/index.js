import {Stripe} from "stripe";

export default (router, { services, env, logger, getSchema, database }) => {
    const { ItemsService } = services;

    router.post('/subscribe', async (req, res) => {
        try {
            console.log('starting subscription');

            const stripeSecretKey = env.STRIPE_SECRET_KEY;

            if (!stripeSecretKey) {
                console.error('No Stripe secret key found. Checked:', {
                    hasRegularKey: !!env.STRIPE_SECRET_KEY,
                    allKeys: Object.keys(env)
                });
                return res.status(500).json({
                    success: false,
                    error: 'Stripe not configured'
                });
            }

            // Initialize Stripe
            const stripe = new Stripe(env.STRIPE_SECRET_KEY);

            const { accountability } = req;
            const { plan_id, success_url, cancel_url, payment_type = 'one_time' } = req.body;

            console.log('Request body:', { plan_id, success_url, cancel_url, payment_type });

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            if (!plan_id) {
                return res.status(400).json({
                    success: false,
                    error: 'plan_id is required',
                });
            }

            const schema = await getSchema();
            const plansService = new ItemsService('subscription_plans', {
                schema: schema,
                accountability: req.accountability,
            });

            // Verify plan exists
            const plan = await plansService.readOne(plan_id);
            console.log("Plan details:", plan);

            if (!plan) {
                return res.status(404).json({
                    success: false,
                    error: 'Subscription plan not found'
                });
            }

            // Get user email
            const usersService = new ItemsService('directus_users', {
                schema: schema,
                accountability: { admin: true } // Need admin to read user data
            });
            const user = await usersService.readOne(accountability.user, {
                fields: ['email', 'first_name', 'last_name']
            });

            console.log("User details:", user);

            if (!user?.email) {
                return res.status(400).json({
                    success: false,
                    error: 'User email not found'
                });
            }

            // Create session parameters - FIXED: removed undefined variables
            let sessionParams = {
                customer_email: user.email,
                mode: payment_type === 'subscription' ? 'subscription' : 'payment',
                success_url: success_url || `${env.PUBLIC_URL || 'http://localhost:8055'}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: cancel_url || `${env.PUBLIC_URL || 'http://localhost:8055'}/subscription/cancel`,
                metadata: {
                    user_id: accountability.user,
                    plan_id: plan_id,
                    payment_type: payment_type
                },
                payment_method_types: ['card'],
            };

            console.log("Session params:", sessionParams);

            // Configure line items based on payment type - FIXED: removed undefined variables
            if (payment_type === 'one_time') {
                // Use plan.price instead of plan.amount
                const amount = plan.price || plan.amount || 0;
                const currency = plan.currency || 'usd';

                sessionParams.line_items = [{
                    price_data: {
                        currency: currency.toLowerCase(),
                        unit_amount: Math.round(amount * 100), // Convert to cents
                        product_data: {
                            name: plan.name || 'Subscription Plan',
                            // description: plan.description || ''
                        }
                    },
                    quantity: 1
                }];
            } else if (payment_type === 'subscription') {
                // For subscriptions, we need a Stripe price ID
                if (!plan.stripe_price_id) {
                    return res.status(400).json({
                        success: false,
                        error: 'Stripe price ID not configured for subscription plan'
                    });
                }
                sessionParams.line_items = [{
                    price: plan.stripe_price_id,
                    quantity: 1
                }];
            }

            console.log("Creating Stripe session...");

            // Create Stripe checkout session
            const session = await stripe.checkout.sessions.create(sessionParams);

            console.log("Stripe session created:", session.id);

            // Create pending transaction record
            const transactionsService = new ItemsService('transactions', {
                schema: schema,
                accountability: req.accountability
            });

            const transaction = await transactionsService.createOne({
                user: accountability.user,
                provider_reference: session.id,
                reference: session.id,
                // provider_reference: session.customer || null,
                amount: payment_type === 'one_time' ? (plan.amount || 0) : 0,
                currency: (plan.currency || 'usd').toLowerCase(),
                status: 'pending',
                payment_type: payment_type,
                payable_id: plan_id,
                payable_type: 'subscription_plans',
                metadata: {
                    session_url: session.url,
                    plan_id: plan_id
                }
            });

            console.log("Transaction created:", transaction.id);

            logger.info(`Checkout session created: ${session.id} for user ${accountability.user}`);

            return res.json({
                success: true,
                session_id: session.id,
                checkout_url: session.url,
                transaction_id: transaction.id
            });

        } catch (error) {
            console.error('Create checkout session error:', error);
            logger.error('Create checkout session error details:', error);

            return res.status(500).json({
                success: false,
                error: 'Failed to create checkout session',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    // ============================================
    // 1. GET AVAILABLE SUBSCRIPTION PLANS
    // ============================================
    router.get('/plans', async (req, res) => {
        try {
            const plansService = new ItemsService('subscription_plans', {
                schema: req.schema,
                // accountability: null,
            });

            const plans = await plansService.readByQuery({
                filter: {
                    status: { _eq: 'published' },
                    is_active: { _eq: true },
                },
                sort: ['sort', 'price'],
                fields: ['*'],
            });

            return res.json({
                success: true,
                data: plans,
            });
        } catch (error) {
            console.error('Get plans error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch subscription plans',
            });
        }
    });

    router.get('/me', async (req, res) => {
        try {
            const { accountability } = req;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const subscriptionsService = new ItemsService('user_subscriptions', {
                schema: req.schema,
                accountability: req.accountability,
            });

            const subscription = await subscriptionsService.readByQuery({
                filter: {
                    user: { _eq: accountability.user },
                    status: { _eq: 'active' },
                },
                fields: [
                    '*',
                    'subscription_plan.*',
                ],
                limit: 1,
            });

            if (subscription.length === 0) {
                return res.json({
                    success: true,
                    data: null,
                    message: 'No active subscription',
                });
            }

            // Flatten the M2M relationships
            const sub = subscription[0];
            // sub.subscribed_regions = sub.regions?.map(r => r.regions_id).filter(Boolean) || [];
            // sub.subscribed_sectors = sub.sectors?.map(s => s.types_id).filter(Boolean) || [];
            // delete sub.regions;
            // delete sub.sectors;

            return res.json({
                success: true,
                data: sub,
            });
        } catch (error) {
            console.error('Get subscription error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch subscription',
            });
        }
    });

    router.post('/cancel', async (req, res) => {
        try {
            const { accountability } = req;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const subscriptionsService = new ItemsService('user_subscriptions', {
                schema: req.schema,
                accountability: req.accountability,
            });

            const existing = await subscriptionsService.readByQuery({
                filter: {
                    user: { _eq: accountability.user },
                    status: { _eq: 'active' },
                },
                limit: 1,
            });

            if (existing.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'No active subscription found',
                });
            }

            await subscriptionsService.updateOne(existing[0].id, {
                status: 'cancelled',
                auto_renew: false,
            });

            // Update user's cached fields
            const usersService = new ItemsService('directus_users', {
                schema: req.schema,
                accountability: { admin: true },
            });

            await usersService.updateOne(accountability.user, {
                subscription_status: 'cancelled',
            });

            return res.json({
                success: true,
                message: 'Subscription cancelled successfully',
            });
        } catch (error) {
            console.error('Cancel error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to cancel subscription',
            });
        }
    });

    router.post('/webho', async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const stripe = new Stripe(env.STRIPE_SECRET_KEY);

        let event;

        try {
            // Verify webhook signature
            event = stripe.webhooks.constructEvent(
                req.body,
                sig,
                env.STRIPE_WEBHOOK_SECRET
            );
        } catch (err) {
            logger.error('Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        logger.info(`Webhook received: ${event.type}`);

        const schema = await getSchema();
        const transactionsService = new ItemsService('transactions', { schema });

        try {
            switch (event.type) {
                case 'checkout.session.completed': {
                    const session = event.data.object;

                    // Find transaction by session ID
                    const transactions = await transactionsService.readByQuery({
                        filter: { stripe_session_id: { _eq: session.id } },
                        limit: 1
                    });

                    if (transactions.length === 0) {
                        logger.warn(`Transaction not found for session: ${session.id}`);
                        break;
                    }

                    const updateData = {
                        // stripe_customer_id: session.customer,
                        provider_reference: session.payment_intent,
                        status: 'completed',
                        completed_at: new Date()
                    };

                    // Handle subscription
                    if (session.mode === 'subscription') {
                        updateData.stripe_subscription_id = session.subscription;
                        updateData.subscription_status = 'active';

                        // Fetch subscription details for period dates
                        const subscription = await stripe.subscriptions.retrieve(session.subscription);
                        updateData.subscription_period_start = new Date(subscription.current_period_start * 1000);
                        updateData.subscription_period_end = new Date(subscription.current_period_end * 1000);
                        updateData.amount = subscription.items.data[0].price.unit_amount / 100;
                        updateData.currency = subscription.currency;
                    }

                    await transactionsService.updateOne(transactions[0].id, updateData);
                    logger.info(`Transaction updated: ${transactions[0].id} - Status: completed`);
                    break;
                }

                case 'payment_intent.succeeded': {
                    const paymentIntent = event.data.object;

                    const transactions = await transactionsService.readByQuery({
                        filter: { provider_reference: { _eq: paymentIntent.id } },
                        limit: 1
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            status: 'completed',
                            completed_at: new Date()
                        });
                        logger.info(`Payment succeeded for transaction: ${transactions[0].id}`);
                    }
                    break;
                }

                case 'payment_intent.payment_failed': {
                    const paymentIntent = event.data.object;

                    const transactions = await transactionsService.readByQuery({
                        filter: { provider_reference: { _eq: paymentIntent.id } },
                        limit: 1
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            status: 'failed',
                            metadata: {
                                ...transactions[0].metadata,
                                failure_message: paymentIntent.last_payment_error?.message
                            }
                        });
                        logger.info(`Payment failed for transaction: ${transactions[0].id}`);
                    }
                    break;
                }

                case 'customer.subscription.updated': {
                    const subscription = event.data.object;

                    const transactions = await transactionsService.readByQuery({
                        filter: { stripe_subscription_id: { _eq: subscription.id } },
                        limit: 1
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            subscription_status: subscription.status,
                            subscription_period_start: new Date(subscription.current_period_start * 1000),
                            subscription_period_end: new Date(subscription.current_period_end * 1000)
                        });
                        logger.info(`Subscription updated: ${transactions[0].id} - Status: ${subscription.status}`);
                    }
                    break;
                }

                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;

                    const transactions = await transactionsService.readByQuery({
                        filter: { stripe_subscription_id: { _eq: subscription.id } },
                        limit: 1
                    });

                    if (transactions.length > 0) {
                        await transactionsService.updateOne(transactions[0].id, {
                            subscription_status: 'cancelled'
                        });
                        logger.info(`Subscription cancelled: ${transactions[0].id}`);
                    }
                    break;
                }

                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;

                    // Handle recurring subscription payments
                    if (invoice.subscription) {
                        const transactions = await transactionsService.readByQuery({
                            filter: { stripe_subscription_id: { _eq: invoice.subscription } },
                            limit: 1
                        });

                        if (transactions.length > 0) {
                            // Create a new transaction record for the recurring payment
                            await transactionsService.createOne({
                                user: transactions[0].user,
                                stripe_customer_id: invoice.customer,
                                stripe_subscription_id: invoice.subscription,
                                provider_reference: invoice.payment_intent,
                                amount: invoice.amount_paid / 100,
                                currency: invoice.currency,
                                status: 'completed',
                                payment_type: 'subscription',
                                subscription_status: 'active',
                                metadata: {
                                    invoice_id: invoice.id,
                                    billing_reason: invoice.billing_reason
                                }
                            });
                            logger.info(`Recurring payment recorded for subscription: ${invoice.subscription}`);
                        }
                    }
                    break;
                }

                case 'invoice.payment_failed': {
                    const invoice = event.data.object;

                    if (invoice.subscription) {
                        const transactions = await transactionsService.readByQuery({
                            filter: { stripe_subscription_id: { _eq: invoice.subscription } },
                            limit: 1
                        });

                        if (transactions.length > 0) {
                            await transactionsService.updateOne(transactions[0].id, {
                                subscription_status: 'past_due',
                                metadata: {
                                    ...transactions[0].metadata,
                                    last_payment_error: invoice.last_payment_error?.message
                                }
                            });
                            logger.warn(`Payment failed for subscription: ${invoice.subscription}`);
                        }
                    }
                    break;
                }

                default:
                    logger.info(`Unhandled event type: ${event.type}`);
            }

            res.json({ received: true });

        } catch (error) {
            logger.error('Webhook processing error:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });

};