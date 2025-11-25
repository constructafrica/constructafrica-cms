export default (router, context) => {
    const { services, exceptions, database } = context;
    const { ItemsService } = services;

    // ============================================
    // 1. GET AVAILABLE SUBSCRIPTION PLANS
    // ============================================
    router.get('/plans', async (req, res) => {
        try {
            const plansService = new ItemsService('subscription_plans', {
                schema: req.schema,
                accountability: req.accountability,
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

    // ============================================
    // 2. GET USER'S CURRENT SUBSCRIPTION
    // ============================================
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

    // ============================================
    // 3. CREATE/UPDATE SUBSCRIPTION
    // ============================================
    router.post('/subscribe', async (req, res) => {
        try {
            const { accountability } = req;
            const { plan_id, regions, sectors, payment_method } = req.body;

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

            const subscriptionsService = new ItemsService('user_subscriptions', {
                schema: req.schema,
                accountability: req.accountability,
            });

            const plansService = new ItemsService('subscription_plans', {
                schema: req.schema,
                accountability: req.accountability,
            });

            // Verify plan exists
            const plan = await plansService.readOne(plan_id);

            // Check if user already has an active subscription
            const existing = await subscriptionsService.readByQuery({
                filter: {
                    user: { _eq: accountability.user },
                    status: { _eq: 'active' },
                },
                limit: 1,
            });

            const now = new Date();
            const endDate = new Date();
            endDate.setFullYear(endDate.getFullYear() + 1); // 1 year subscription

            let subscriptionId;

            if (existing.length > 0) {
                // Update existing subscription
                await subscriptionsService.updateOne(existing[0].id, {
                    subscription_plan: plan_id,
                    status: 'active',
                    end_date: endDate.toISOString(),
                    last_payment_date: now.toISOString(),
                    payment_method: payment_method || existing[0].payment_method,
                });
                subscriptionId = existing[0].id;

                // Clear existing regions and sectors
                // await database('user_subscription_regions')
                //     .where('user_subscriptions_id', subscriptionId)
                //     .delete();
                // await database('user_subscription_sectors')
                //     .where('user_subscriptions_id', subscriptionId)
                //     .delete();
            } else {
                // Create new subscription
                const newSub = await subscriptionsService.createOne({
                    user: accountability.user,
                    subscription_plan: plan_id,
                    status: 'active',
                    start_date: now.toISOString(),
                    end_date: endDate.toISOString(),
                    last_payment_date: now.toISOString(),
                    payment_method: payment_method || 'card',
                    auto_renew: true,
                });
                subscriptionId = newSub.id;
            }

            // Add regions (only for projects subscriptions)
            // if (plan.type === 'projects' && regions && regions.length > 0) {
            //     const regionRecords = regions.map(regionId => ({
            //         user_subscriptions_id: subscriptionId,
            //         regions_id: regionId,
            //     }));
            //     await database('user_subscription_regions').insert(regionRecords);
            // }

            // Add sectors (only for projects subscriptions)
            // if (plan.type === 'projects' && sectors && sectors.length > 0) {
            //     const sectorRecords = sectors.map(sectorId => ({
            //         user_subscriptions_id: subscriptionId,
            //         types_id: sectorId,
            //     }));
            //     await database('user_subscription_sectors').insert(sectorRecords);
            // }

            // Update user's cached subscription fields
            const usersService = new ItemsService('directus_users', {
                schema: req.schema,
                accountability: { admin: true }, // Need admin to update users
            });

            await usersService.updateOne(accountability.user, {
                active_subscription: subscriptionId,
                subscription_type: plan.type,
                subscription_status: 'active',
                subscription_expires_at: endDate.toISOString(),
            });

            return res.json({
                success: true,
                message: 'Subscription created successfully',
                subscription_id: subscriptionId,
            });
        } catch (error) {
            console.error('Subscribe error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create subscription',
                details: error.message,
            });
        }
    });

    // ============================================
    // 4. CANCEL SUBSCRIPTION
    // ============================================
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

    // ============================================
    // 5. CHECK ACCESS TO SPECIFIC PROJECT
    // ============================================
    router.get('/check-access/:collection/:item_id', async (req, res) => {
        try {
            const { accountability } = req;
            const { collection, item_id } = req.params;

            // Public collections are always accessible
            const publicCollections = ['opinions', 'blogs', 'events', 'main_news'];
            if (publicCollections.includes(collection)) {
                return res.json({
                    success: true,
                    has_access: true,
                    reason: 'public_content',
                });
            }

            // Not authenticated = no access to restricted content
            if (!accountability?.user) {
                return res.json({
                    success: true,
                    has_access: false,
                    reason: 'authentication_required',
                });
            }

            // Get user's subscription info from cache
            const usersService = new ItemsService('directus_users', {
                schema: req.schema,
                accountability: { admin: true },
            });

            const user = await usersService.readOne(accountability.user, {
                fields: ['subscription_type', 'subscription_status', 'active_subscription'],
            });

            // No active subscription
            if (user.subscription_status !== 'active') {
                return res.json({
                    success: true,
                    has_access: false,
                    reason: 'no_active_subscription',
                });
            }

            // News subscribers can access news
            if (collection === 'main_news' && ['news', 'projects'].includes(user.subscription_type)) {
                return res.json({
                    success: true,
                    has_access: true,
                    reason: 'news_subscription',
                });
            }

            // For projects and companies, need projects subscription
            if (['projects', 'companies'].includes(collection)) {
                if (user.subscription_type !== 'projects') {
                    return res.json({
                        success: true,
                        has_access: false,
                        reason: 'projects_subscription_required',
                    });
                }

                // Get the item to check its regions and sectors
                const itemService = new ItemsService(collection, {
                    schema: req.schema,
                    accountability: { admin: true },
                });

                const item = await itemService.readOne(item_id, {
                    fields: [
                        'id',
                        collection === 'projects' ? 'regions.regions_id.id' : null,
                        collection === 'projects' ? 'types.types_id.id' : null,
                    ].filter(Boolean),
                });

                // Get user's subscribed regions and sectors
                const userRegions = await database('user_subscription_regions')
                    .where('user_subscriptions_id', user.active_subscription)
                    .pluck('regions_id');

                const userSectors = await database('user_subscription_sectors')
                    .where('user_subscriptions_id', user.active_subscription)
                    .pluck('types_id');

                if (collection === 'projects') {
                    const projectRegions = item.regions?.map(r => r.regions_id?.id).filter(Boolean) || [];
                    const projectSectors = item.types?.map(t => t.types_id?.id).filter(Boolean) || [];

                    // Check if any project region matches user's subscribed regions
                    const hasRegionMatch = projectRegions.some(r => userRegions.includes(r));

                    // Check if any project sector matches user's subscribed sectors
                    const hasSectorMatch = projectSectors.some(s => userSectors.includes(s));

                    // Both must match (AND logic)
                    if (hasRegionMatch && hasSectorMatch) {
                        return res.json({
                            success: true,
                            has_access: true,
                            reason: 'subscription_match',
                        });
                    } else {
                        return res.json({
                            success: true,
                            has_access: false,
                            reason: 'region_or_sector_not_subscribed',
                            details: {
                                region_match: hasRegionMatch,
                                sector_match: hasSectorMatch,
                            },
                        });
                    }
                }

                // For companies, just check if they have projects subscription
                return res.json({
                    success: true,
                    has_access: true,
                    reason: 'projects_subscription',
                });
            }

            // Default: no access
            return res.json({
                success: true,
                has_access: false,
                reason: 'unknown_collection',
            });
        } catch (error) {
            console.error('Check access error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to check access',
                details: error.message,
            });
        }
    });

    // ============================================
    // 6. GET USER'S ACCESSIBLE REGIONS & SECTORS
    // ============================================
    router.get('/my-access', async (req, res) => {
        try {
            const { accountability } = req;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const usersService = new ItemsService('directus_users', {
                schema: req.schema,
                accountability: { admin: true },
            });

            const user = await usersService.readOne(accountability.user, {
                fields: ['subscription_type', 'subscription_status', 'active_subscription'],
            });

            if (user.subscription_status !== 'active') {
                return res.json({
                    success: true,
                    subscription_type: 'none',
                    accessible_regions: [],
                    accessible_sectors: [],
                });
            }

            if (user.subscription_type === 'news') {
                return res.json({
                    success: true,
                    subscription_type: 'news',
                    accessible_regions: [],
                    accessible_sectors: [],
                    message: 'News subscription - no project access',
                });
            }

            // Get subscribed regions
            const regions = await database('user_subscription_regions as usr')
                .join('regions as r', 'usr.regions_id', 'r.id')
                .where('usr.user_subscriptions_id', user.active_subscription)
                .select('r.id', 'r.name');

            // Get subscribed sectors
            const sectors = await database('user_subscription_sectors as uss')
                .join('types as t', 'uss.types_id', 't.id')
                .where('uss.user_subscriptions_id', user.active_subscription)
                .select('t.id', 't.name');

            return res.json({
                success: true,
                subscription_type: user.subscription_type,
                accessible_regions: regions,
                accessible_sectors: sectors,
            });
        } catch (error) {
            console.error('Get access error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch accessible regions and sectors',
            });
        }
    });
};