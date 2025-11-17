export default (router, context) => {
    // Properly destructure from context for bundles
    const {services, exceptions, database, env, logger, getSchema} = context;
    const {ItemsService} = services;
    const {ForbiddenException, InvalidPayloadException, ServiceUnavailableException} = exceptions;

    // ============================================
    // RECENT VIEWS FUNCTIONALITY
    // ============================================

    // Allowed collections for recent views
    const recentViewCollections = ['projects', 'companies', 'main_news', 'projects_tenders'];


    // ============================================
    // 9. GET USER'S RECENT VIEWS
    // ============================================
    router.get('/', async (req, res) => {
        try {
            const { accountability } = req;
            const {
                collection: filterCollection,
                limit = 20,
                offset = 0,
            } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'You must be authenticated to view recent history',
                });
            }

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (filterCollection) {
                if (!recentViewCollections.includes(filterCollection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection filter. Must be one of: ${recentViewCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: filterCollection };
            }

            // Get recent views with pagination (sorted by most recent first)
            const recentViews = await recentViewsService.readByQuery({
                filter,
                sort: ['-date_updated', '-date_created'],
                limit: parseInt(limit),
                offset: parseInt(offset),
            });

            // Get total count
            const totalCount = await recentViewsService.readByQuery({
                filter,
                aggregate: { count: ['*'] },
            });

            // Group by collection and fetch actual items with details
            const grouped = {
                projects: [],
                companies: [],
            };

            const collectionCounts = {
                projects: 0,
                companies: 0,
            };

            for (const view of recentViews) {
                if (!grouped[view.collection]) continue;

                try {
                    const itemService = new ItemsService(view.collection, {
                        schema: schema,
                        accountability: req.accountability,
                    });

                    // Fetch the item with specific fields based on collection
                    let fields = ['id', 'status', 'date_created', 'date_updated'];

                    if (view.collection === 'projects') {
                        fields.push('title', 'slug', 'summary', 'featured_image', 'contract_value_usd', 'current_stage');
                    } else if (view.collection === 'companies') {
                        fields.push('name', 'slug', 'company_role', 'logo', 'description');
                    }

                    const item = await itemService.readOne(view.item_id, {
                        fields: fields,
                    });

                    grouped[view.collection].push({
                        // View metadata
                        view_id: view.id,
                        view_date: view.date_created,
                        last_viewed: view.date_updated,
                        // Item data
                        ...item,
                    });

                    collectionCounts[view.collection]++;
                } catch (error) {
                    // Item might be deleted or user doesn't have access
                    console.warn(`Could not fetch ${view.collection} item ${view.item_id}:`, error.message);

                    // Optionally remove the recent view if item no longer exists
                    try {
                        await recentViewsService.deleteOne(view.id);
                    } catch (deleteError) {
                        console.warn(`Could not delete orphaned recent view ${view.id}:`, deleteError.message);
                    }
                }
            }

            return res.json({
                success: true,
                total: totalCount[0]?.count || 0,
                limit: parseInt(limit),
                offset: parseInt(offset),
                counts: collectionCounts,
                recent_views: grouped,
            });
        } catch (error) {
            console.error('Get recent views error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recent views',
                details: error.message,
            });
        }
    });

// ============================================
// 10. CLEAR RECENT VIEWS
// ============================================
    router.delete('/clear', async (req, res) => {
        try {
            const { accountability } = req;
            const { collection } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (collection) {
                if (!recentViewCollections.includes(collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection. Must be one of: ${recentViewCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: collection };
            }

            // Get views to delete
            const toDelete = await recentViewsService.readByQuery({
                filter,
                limit: -1,
                fields: ['id'],
            });

            if (toDelete.length === 0) {
                return res.json({
                    success: true,
                    message: 'No recent views to delete',
                    deleted: 0,
                });
            }

            // Delete views
            const ids = toDelete.map(view => view.id);
            await recentViewsService.deleteMany(ids);

            return res.json({
                success: true,
                message: `Deleted ${toDelete.length} recent view(s)`,
                deleted: toDelete.length,
                collection: collection || 'all',
            });
        } catch (error) {
            console.error('Clear recent views error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to clear recent views',
                details: error.message,
            });
        }
    });

// ============================================
// 11. GET RECENT VIEWS STATISTICS
// ============================================
    router.get('/stats', async (req, res) => {
        try {
            const { accountability } = req;
            const { period = 'week' } = req.query; // 'day', 'week', 'month'

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Calculate date range
            const now = new Date();
            let startDate;

            switch (period) {
                case 'day':
                    startDate = new Date(now.setDate(now.getDate() - 1));
                    break;
                case 'week':
                    startDate = new Date(now.setDate(now.getDate() - 7));
                    break;
                case 'month':
                    startDate = new Date(now.setMonth(now.getMonth() - 1));
                    break;
                default:
                    startDate = new Date(now.setDate(now.getDate() - 7));
            }

            // Get view counts by collection for the period
            const projectsViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'projects' },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: { count: ['*'] },
            });

            const companiesViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'companies' },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: { count: ['*'] },
            });

            // Get most frequently viewed items
            const frequentViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: {
                    groupBy: ['collection', 'item_id'],
                    count: ['*'],
                },
                sort: ['-count'],
                limit: 5,
            });

            return res.json({
                success: true,
                period,
                stats: {
                    total: (projectsViews[0]?.count || 0) + (companiesViews[0]?.count || 0),
                    by_collection: {
                        projects: projectsViews[0]?.count || 0,
                        companies: companiesViews[0]?.count || 0,
                    },
                    start_date: startDate.toISOString(),
                    frequent_items: frequentViews,
                },
            });
        } catch (error) {
            console.error('Get recent views stats error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recent views statistics',
                details: error.message,
            });
        }
    });
};