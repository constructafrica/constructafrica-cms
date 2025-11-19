export default ({ action }, { services, database, getSchema }) => {
    const { ItemsService } = services;

    console.log('Recent Views Action Hook: Registered');

    // Use action hooks for better context
    action('projects.items.read', async (meta, context) => {
        await handleItemRead('projects', meta, context.accountability);
    });

    action('companies.items.read', async (meta, context) => {
        await handleItemRead('companies', meta, context.accountability);
    });

    action('projects_tenders.items.read', async (meta, context) => {
        await handleItemRead('projects_tenders', meta, context.accountability);
    });

    action('main_news.items.read', async (meta, context) => {
        await handleItemRead('main_news', meta, context.accountability);
    });

    action('experts_analysts.items.read', async (meta, context) => {
        await handleItemRead('experts_analysts', meta, context.accountability);
    });

    async function handleItemRead(collection, meta, accountability) {
        try {
            // console.log('Accountability object:', JSON.stringify(accountability, null, 2));

            const { payload, query } = meta;

            // Check if this is a single item read by examining the query filter
            // Single item reads will have query.filter.id._eq set to a specific ID
            let itemId = null;

            if (query?.filter?.id?._eq) {
                // This is a single item request via /items/collection/id
                itemId = query.filter.id._eq;
            } else if (payload && Array.isArray(payload) && payload.length === 1 && payload[0]?.id) {
                // Fallback: if payload contains exactly one item, track it
                itemId = payload[0].id;
            }

            if (itemId) {
                await trackRecentView(collection, itemId, accountability);
                console.log(`Tracked single item view: ${collection}:${itemId}`);
            } else {
                console.log(`Skipped tracking for ${collection} - list view or multiple items`);
            }
        } catch (error) {
            console.error(`Error handling ${collection} read:`, error);
        }
    }

    async function trackRecentView(collection, itemId, accountability) {
        try {
            // console.log('trackRecentView called with:', { collection, itemId, user: accountability?.user });

            // Only track for authenticated users
            if (!accountability?.user) {
                console.log('No authenticated user, skipping tracking');
                return;
            }

            const schema = await getSchema();
            // console.log('Schema retrieved');

            // Create recent views service
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: accountability,
            });
            console.log('Recent views service created', accountability.user, collection, itemId);

            // Check if view already exists for this user and item
            const existingView = await recentViewsService.readByQuery({
                filter: {
                    _and: [
                        { user_created: { _eq: accountability.user } },
                        { collection: { _eq: collection } },
                        { item_id: { _eq: itemId } },
                    ],
                },
                limit: 1,
            });


            console.log('Existing view check result:', existingView);

            const now = new Date().toISOString();

            if (existingView.length > 0) {
                // console.log('Updating existing view:', existingView[0].id);
                // Update the timestamp of existing view
                const updated = await recentViewsService.updateOne(existingView[0].id, {
                    date_updated: now,
                });
                console.log(`Updated recent view for ${collection}:${itemId}`, updated);
            } else {
                // console.log('Creating new view');
                // Create new recent view
                const created = await recentViewsService.createOne({
                    collection,
                    item_id: itemId,
                    date_updated: now,
                });
                console.log(`Created recent view for ${collection}:${itemId}`, created);

                // Optional: Limit total recent views per user to prevent unlimited growth
                await enforceRecentViewsLimit(accountability.user, recentViewsService);
            }
        } catch (error) {
            console.error('Error tracking recent view:', error);
            console.error('Error stack:', error.stack);
            // Don't throw error to avoid breaking the original read operation
        }
    }

    async function enforceRecentViewsLimit(userId, recentViewsService, maxViews = 100) {
        try {
            // Get user's recent views count
            const userViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: userId }
                },
                sort: ['-date_updated'],
                limit: -1,
                fields: ['id', 'date_updated']
            });

            // If over limit, delete oldest views
            if (userViews.length > maxViews) {
                const viewsToDelete = userViews.slice(maxViews);
                const idsToDelete = viewsToDelete.map(view => view.id);

                await recentViewsService.deleteMany(idsToDelete);
                console.log(`Cleaned up ${viewsToDelete.length} old recent views for user ${userId}`);
            }
        } catch (error) {
            console.error('Error enforcing recent views limit:', error);
        }
    }
};