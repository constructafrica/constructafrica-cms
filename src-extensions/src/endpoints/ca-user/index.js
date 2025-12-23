import multer from 'multer';
import { Readable } from 'stream';

// Configure multer for file upload
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Accept only image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'));
        }
    }
});

export default (router, { services, env, logger, getSchema}) => {
    const {ItemsService, UsersService, FilesService} = services;


    router.post('/avatar', upload.single('avatar'), async (req, res) => {
        logger.info('📸 Avatar update request received');

        try {
            // Check if user is authenticated
            if (!req.accountability || !req.accountability.user) {
                logger.error('No accountability found');
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.accountability.user;
            logger.info(`User ID: ${userId}`);

            // Check if file was uploaded
            if (!req.file) {
                logger.error('No file in request');
                return res.status(422).json({
                    success: false,
                    message: 'No file uploaded. Please provide an avatar image.'
                });
            }

            logger.info(`File received: ${req.file.originalname}, size: ${req.file.size}, type: ${req.file.mimetype}`);

            const usersService = new UsersService({
                schema: req.schema,
                accountability: req.accountability
            });

            const filesService = new FilesService({
                schema: req.schema,
                accountability: req.accountability
            });

            logger.info('Services initialized');

            // Get current user to check if they have an existing avatar
            const currentUser = await usersService.readOne(userId, {
                fields: ['id', 'avatar', 'email']
            });

            logger.info(`Current user fetched: ${currentUser.email}`);

            // Convert buffer to readable stream for Directus
            const stream = Readable.from(req.file.buffer);

            // Upload new avatar to Directus files
            const fileData = {
                filename_download: req.file.originalname,
                filename_disk: `${userId}_${Date.now()}_${req.file.originalname}`,
                type: req.file.mimetype,
                filesize: req.file.size,
                title: `Avatar for user ${userId}`,
                storage: 's3'
            };

            logger.info('About to upload file to Directus...');

            // Create the file in Directus
            const uploadedFile = await filesService.uploadOne(stream, fileData);

            logger.info(`✅ File uploaded with ID: ${uploadedFile}`);

            // Update user's avatar field
            await usersService.updateOne(userId, {
                avatar: uploadedFile
            });

            logger.info(`✅ Avatar updated for user: ${userId}`);

            // Optional: Delete old avatar if it exists
            if (currentUser.avatar) {
                try {
                    await filesService.deleteOne(currentUser.avatar);
                    logger.info(`🗑️ Old avatar deleted: ${currentUser.avatar}`);
                } catch (deleteError) {
                    logger.warn('Failed to delete old avatar:', deleteError);
                    // Don't fail the request if old file deletion fails
                }
            }

            // Get the updated user with avatar URL
            // const updatedUser = await usersService.readOne(userId, {
            //     fields: ['id', 'email', 'first_name', 'last_name', 'avatar']
            // });

            return res.json({
                success: true,
                message: 'Avatar updated successfully',
                data: {
                    avatar: `${env.PUBLIC_URL}/assets/${uploadedFile}`
                }
            });

        } catch (error) {
            logger.error('❌ Avatar update error:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
                code: error.code
            });

            // Handle specific errors
            if (error.message.includes('Invalid file type')) {
                return res.status(422).json({
                    success: false,
                    message: error.message
                });
            }

            if (error.code === 'LIMIT_FILE_SIZE') {
                return res.status(422).json({
                    success: false,
                    message: 'File too large. Maximum size is 5MB.'
                });
            }

            return res.status(500).json({
                success: false,
                message: 'Failed to update avatar. Please try again.',
                debug: error.message
            });
        }
    });

    // Get current user's avatar URL - requires authentication
    router.get('/me', async (req, res) => {
        try {
            // Ensure authentication
            if (!req.accountability || !req.accountability.user) {
                return res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
            }

            const userId = req.accountability.user;

            // Use services from context, not direct import
            const { UsersService } = services;

            const usersService = new UsersService({
                schema: await getSchema(),
                accountability: req.accountability
            });

            // Fetch user with role + avatar
            const user = await usersService.readOne(userId, {
                fields: [
                    'id',
                    'email',
                    'first_name',
                    'last_name',
                    'company',
                    'job_title',
                    'phone',
                    'email_notifications',
                    'subscription_start',
                    'subscription_status',
                    'subscription_expiry',
                    'active_subscription.*',
                    'subscription_plan.id',
                    'subscription_plan.name',
                    'subscription_plan.slug',
                    'subscription_plan.type',
                    'subscription_plan.price',
                    'subscription_plan.currency',
                    'subscription_plan.billing_period',
                    'status',
                    'role.id',
                    'role.name',
                    'role.slug',
                    'avatar.id',
                ]
            });

            // Build avatar URL safely
            const avatar = user.avatar?.id
                ? `${env.PUBLIC_URL}/assets/${user.avatar.id}`
                : null;

            // Resolve permissions from accountability
            const policies = req.accountability?.permissions || [];

            return res.json({
                success: true,
                data: {
                    id: user.id,
                    email: user.email,
                    first_name: user.first_name,
                    last_name: user.last_name,
                    company: user.company,
                    job_title: user.job_title,
                    phone: user.phone,
                    status: user.status,
                    email_notifications: user.email_notifications,

                    avatar,

                    role: user.role
                        ? {
                            id: user.role.id,
                            name: user.role.name,
                            slug: user.role.slug,
                        }
                        : null,

                    policies,
                    subscription: {
                        activeSubscription: user.active_subscription || null,
                        plan: user.subscription_plan || null,
                        start: user.subscription_start || null,
                        expiry: user.subscription_expiry || null,
                        status: user.subscription_status || null,
                    }
                }
            });

        } catch (error) {
            logger.error('❌ Get /me error:', {
                message: error.message,
                stack: error.stack,
                userId: req.accountability?.user
            });

            return res.status(500).json({
                success: false,
                message: 'Failed to retrieve user information',
                error: error.message // Include error message for debugging
            });
        }
    });

    router.get('/editors', async (req, res, next) => {
        try {
            const schema = await getSchema();

            // Get the role ID for 'editor' role
            const rolesService = new ItemsService('directus_roles', {
                schema: schema,
                accountability: req.accountability
            });

            const editorRoles = await rolesService.readByQuery({
                filter: {
                    name: { _eq: 'Editor' }
                },
                limit: 1
            });

            if (editorRoles.length === 0) {
                return res.status(404).json({
                    error: 'Editor role not found'
                });
            }

            const editorRoleId = editorRoles[0].id;

            // Get all users with the editor role
            const usersService = new ItemsService('directus_users', {
                schema: schema,
                accountability: req.accountability
            });

            const editorUsers = await usersService.readByQuery({
                filter: {
                    role: { _eq: editorRoleId }
                },
                fields: [
                    'id',
                    'first_name',
                    'last_name',
                    'email',
                    'avatar',
                    'avatar.id',
                    'avatar.filename_disk',
                    'avatar.title',
                    'avatar.filesize',
                    'title',
                    'status'
                ],
                sort: ['first_name', 'last_name']
            });

            // Transform avatar URLs if they exist
            const usersWithAvatars = editorUsers.map(user => ({
                ...user,
                avatar_url: user.avatar
                    ? `${process.env.PUBLIC_URL}/assets/${user.avatar}`
                    : null
            }));

            return res.json({
                data: usersWithAvatars,
                meta: {
                    total: usersWithAvatars.length
                }
            });

        } catch (error) {
            console.error('Get editor users error:', error);
            next(error);
        }
    });


}