
export default (router, { services, getSchema}) => {
    const {ItemsService} = services;

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