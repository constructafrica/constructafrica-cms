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

            const notifications = await notificationsService.readByQuery({
                filter,
                sort: ['-created_at'],
                limit,
                page,
            });

            // Get unread count
            const unreadCountResult = await notificationsService.readByQuery({
                filter: {
                    user: { _eq: userId },
                    is_read: { _eq: false },
                },
                aggregate: { count: '*' },
            });

            const unreadCount = unreadCountResult?.[0]?.count || 0;

            return res.json({
                success: true,
                data: notifications,
                meta: {
                    page,
                    limit,
                    unread_count: unreadCount,
                },
            });
        } catch (error) {
            console.error('[NOTIFICATIONS_ENDPOINT]', error);

            return res.status(500).json({
                success: false,
                message: 'Failed to load notifications',
            });
        }
    });
});
