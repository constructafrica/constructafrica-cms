export default (router, { services, env, logger, getSchema }) => {
    const {ItemsService, UsersService} = services;

    router.get('/', async (req, res) => {
        logger.info('💬 Get comments request received');

        try {
            const { entity_type, entity_id, page = 1, limit = 20 } = req.query;

            // Validate required params
            if (!entity_type || !entity_id) {
                return res.status(422).json({
                    success: false,
                    message: 'entity_type and entity_id are required'
                });
            }

            // Validate entity_type
            const allowedEntityTypes = ['projects', 'main_news', 'tenders'];
            if (!allowedEntityTypes.includes(entity_type)) {
                return res.status(422).json({
                    success: false,
                    message: `Invalid entity_type. Must be one of: ${allowedEntityTypes.join(', ')}`
                });
            }

            const commentsService = new ItemsService('comments', {
                schema: req.schema,
                accountability: req.accountability
            });

            const offset = (Number(page) - 1) * Number(limit);

            // Fetch comments
            const result = await commentsService.readByQuery({
                filter: {
                    _and: [
                        { entity_type: { _eq: entity_type } },
                        { entity_id: { _eq: entity_id } }
                    ]
                },
                sort: ['-date_created'],
                limit: Number(limit),
                offset,
                meta: ['total_count', 'filter_count'],
                fields: [
                    '*',
                    'user_created.email',
                    'user_created.first_name',
                    'user_created.last_name',
                    'user_created.avatar'
                ]
            });

            const comments = result.data || result;
            const meta = result.meta || {};

            return res.json({
                success: true,
                data: comments,
                meta: {
                    page: Number(page),
                    limit: Number(limit),
                    total_count: meta.total_count ?? comments.length,
                    filter_count: meta.filter_count ?? comments.length,
                    page_count: meta.total_count
                        ? Math.ceil(meta.total_count / limit)
                        : 1
                }
            });

        } catch (error) {
            logger.error('❌ Get comments error:', {
                message: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to fetch comments'
            });
        }
    });


    // Create a new comment
    router.post('/create', async (req, res) => {
        logger.info('💬 Create comment request received');

        try {
            // Check if user is authenticated
            if (!req.accountability || !req.accountability.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.accountability.user;
            const {subject, content, entity_type, entity_id} = req.body;

            // Validate required fields
            if (!content || !entity_type || !entity_id) {
                return res.status(422).json({
                    success: false,
                    message: 'Content, entity_type, and entity_id are required'
                });
            }

            // Validate entity_type
            const allowedEntityTypes = ['projects', 'main_news', 'tenders'];
            if (!allowedEntityTypes.includes(entity_type)) {
                return res.status(422).json({
                    success: false,
                    message: `Invalid entity_type. Must be one of: ${allowedEntityTypes.join(', ')}`
                });
            }

            // Verify entity exists
            const entityService = new ItemsService(entity_type, {
                schema: req.schema,
                accountability: req.accountability
            });

            try {
                await entityService.readOne(entity_id);
            } catch (error) {
                return res.status(404).json({
                    success: false,
                    message: `${entity_type} with ID ${entity_id} not found`
                });
            }

            // Create comment
            const commentsService = new ItemsService('comments', {
                schema: req.schema,
                accountability: req.accountability
            });

            const comment = await commentsService.createOne({
                subject: subject || null,
                content,
                entity_type,
                entity_id,
                user_created: userId,
                date_created: new Date().toISOString()
            });

            logger.info(`✅ Comment created with ID: ${comment}`);

            // Fetch the created comment with user details
            const createdComment = await commentsService.readOne(comment, {
                fields: ['*', 'user_created.id', 'user_created.email', 'user_created.first_name', 'user_created.last_name', 'user_created.avatar']
            });

            return res.json({
                success: true,
                message: 'Comment created successfully',
                data: createdComment
            });

        } catch (error) {
            logger.error('❌ Create comment error:', {
                message: error,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to create comment. Please try again.'
            });
        }
    });

}