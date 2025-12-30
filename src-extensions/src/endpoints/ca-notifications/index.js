import { defineEndpoint } from '@directus/extensions-sdk';

export default defineEndpoint((router, { services }) => {
    const { ItemsService } = services;

    /**
     * GET /notifications/me
     */
    router.get('/me', async (req, res) => {
        try {
            // Ensure user is authenticated
            if (!req.accountability?.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required',
                });
            }

            const userId = req.accountability.user;
            const schema = req.schema;

            const notificationsService = new ItemsService('notifications', {
                schema,
                accountability: req.accountability,
            });

            // Query params
            const limit = Number(req.query.limit || 20);
            const page = Number(req.query.page || 1);
            const unreadOnly = req.query.unread === 'true';

            const filter = {
                user: { _eq: userId },
            };

            if (unreadOnly) {
                filter.is_read = { _eq: false };
            }

            // Fetch notifications
            const notifications = await notificationsService.readByQuery({
                filter,
                sort: ['-date_created'],
                limit,
                page,
                fields: ['*'], // Explicitly specify fields
            });

            console.log('[NOTIFICATIONS_ENDPOINT] Notifications result:', notifications);

            // Get unread count - use getItemCount instead of aggregate
            const unreadCount = await notificationsService.readByQuery({
                filter: {
                    user: { _eq: userId },
                    is_read: { _eq: false },
                },
                limit: 0, // Don't return items
                meta: ['total_count'], // Request total count in meta
            });

            console.log('[NOTIFICATIONS_ENDPOINT] Unread count result:', unreadCount);

            // Extract the actual count
            const totalUnread = unreadCount?.meta?.total_count || 0;

            return res.json({
                success: true,
                data: notifications || [],
                meta: {
                    page,
                    limit,
                    unread_count: totalUnread,
                    total_count: notifications?.length || 0,
                },
            });
        } catch (error) {
            console.error('[NOTIFICATIONS_ENDPOINT] Error:', error);
            console.error('[NOTIFICATIONS_ENDPOINT] Error stack:', error.stack);

            return res.status(500).json({
                success: false,
                message: 'Failed to load notifications',
                error: error.message,
            });
        }
    });
});
