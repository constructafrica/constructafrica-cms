export default (router, { services, env, logger, getSchema }) => {
    const {ItemsService, UsersService} = services;

    router.get('/', async (req, res) => {
        logger.info('💬 Get newsletters request received');

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
            const allowedEntityTypes = ['projects', 'companies', 'main_news', 'tenders', 'experts_analysts'];
            if (!allowedEntityTypes.includes(entity_type)) {
                return res.status(422).json({
                    success: false,
                    message: `Invalid entity_type. Must be one of: ${allowedEntityTypes.join(', ')}`
                });
            }

            const newslettersService = new ItemsService('user_newsletters', {
                schema: req.schema,
                accountability: req.accountability
            });

            const offset = (Number(page) - 1) * Number(limit);

            // Fetch newsletters
            const result = await newslettersService.readByQuery({
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

            const newsletters = result.data || result;
            const meta = result.meta || {};

            return res.json({
                success: true,
                data: newsletters,
                meta: {
                    page: Number(page),
                    limit: Number(limit),
                    total_count: meta.total_count ?? newsletters.length,
                    filter_count: meta.filter_count ?? newsletters.length,
                    page_count: meta.total_count
                        ? Math.ceil(meta.total_count / limit)
                        : 1
                }
            });

        } catch (error) {
            logger.error('❌ Get newsletters error:', {
                message: error.message,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to fetch newsletters'
            });
        }
    });


    // Create a new newsletter
    router.post('/create', async (req, res) => {
        logger.info('💬 Create newsletter request received');

        try {
            // Check if user is authenticated
            if (!req.accountability || !req.accountability.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.accountability.user;
            const {entity_type, entity_id} = req.body;

            // Validate required fields
            if (!entity_type || !entity_id) {
                return res.status(422).json({
                    success: false,
                    message: 'Entity_type, and entity_id are required'
                });
            }

            // Validate entity_type
            const allowedEntityTypes = ['projects', 'main_news','companies', 'tenders'];
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

            // Create newsletter
            const newslettersService = new ItemsService('user_newsletters', {
                schema: req.schema,
                accountability: req.accountability
            });

            const newsletter = await newslettersService.createOne({
                entity_type,
                entity_id,
                user_created: userId,
                date_created: new Date().toISOString()
            });

            logger.info(`✅ Newsletter created with ID: ${newsletter}`);

            return res.json({
                success: true,
                message: 'Newsletter created successfully',
            });

        } catch (error) {
            logger.error('❌ Create newsletter error:', {
                message: error,
                stack: error.stack
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to create newsletter. Please try again.'
            });
        }
    });

}