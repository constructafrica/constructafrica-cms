export default ({ action }, { services, database, getSchema }) => {
    const { ItemsService } = services;

    action('projects.read', async (meta, { accountability }) => {
        await trackRecentView('projects', meta.key, accountability);
    });

    action('companies.read', async (meta, { accountability }) => {
        await trackRecentView('companies', meta.key, accountability);
    });

    async function trackRecentView(collection, itemId, accountability) {
        try {
            // Only track for authenticated users
            if (!accountability?.user) {
                return;
            }

            const schema = await getSchema();

            // Create recent views service
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: accountability,
            });


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

            const now = new Date().toISOString();

            if (existingView.length > 0) {
                // Update the timestamp of existing view
                await recentViewsService.updateOne(existingView[0].id, {
                    date_updated: now,
                });

                console.log(`Updated recent view for ${collection}:${itemId}`);
            } else {
                // Create new recent view
                await recentViewsService.createOne({
                    collection,
                    item_id: itemId,
                    date_updated: now,
                });

                console.log(`Created recent view for ${collection}:${itemId}`);

                // Optional: Limit total recent views per user to prevent unlimited growth
                await enforceRecentViewsLimit(accountability.user, recentViewsService);
            }
        } catch (error) {
            console.error('Error tracking recent view:', error);
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