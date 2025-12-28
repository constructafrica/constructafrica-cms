export default ({ action }, { services, database }) => {
    const { ItemsService } = services;

    // Hook to update project's news_update_at when news is created or updated
    action('news_updates.items.create', async ({ payload, key, collection }, { schema, accountability }) => {
        try {
            console.log('[NEWS_UPDATE_HOOK] News update created:', key);

            // Only notify when published
            if (payload.status !== 'published') {
                return;
            }

            // Get the project_id from the created news update
            const projectId = payload.project;

            if (!projectId) {
                console.log('[NEWS_UPDATE_HOOK] No project_id found in payload');
                return;
            }

            console.log('[NEWS_UPDATE_HOOK] Updating project:', projectId);

            // Update the project's news_update_at field
            const projectsService = new ItemsService('projects', {
                schema,
                accountability,
            });

            const favouritesService = new ItemsService('favourites', {
                schema,
                accountability,
            });

            const notificationsService = new ItemsService('notifications', {
                schema,
                accountability,
            });

            const usersService = new UsersService({
                schema,
                accountability,
            });

            await projectsService.updateOne(projectId, {
                news_update_at: new Date().toISOString()
            });

            // Get users who favourited this project
            const favourites = await favouritesService.readByQuery({
                filter: {
                    collection: { _eq: 'projects' },
                    item_id: { _eq: projectId },
                },
                fields: ['user_created'],
                limit: -1,
            });

            if (!favourites.length) return;

            // Fetch project details
            const project = await projectsService.readOne(projectId, {
                fields: ['id', 'title'],
            });

            // send email to users that have the project as favourites

            for (const fav of favourites) {
                const userId = fav.user_created;
                if (!userId) continue;

                const user = await usersService.readOne(userId, {
                    fields: ['email', 'first_name'],
                });

                /** 🔔 CREATE NOTIFICATION */
                await notificationsService.createOne({
                    user: userId,
                    title: 'Project Update',
                    message: `A new update was posted on ${project.title}`,
                    collection: 'projects',
                    item: projectId,
                    is_read: false,
                });

                /** 📧 SEND EMAIL */
                await resend.emails.send({
                    from: env.EMAIL_FROM,
                    to: user.email,
                    subject: `New update on project ${project.title}`,
                    html: `
                            <p>Hi ${user.first_name || 'there'},</p>
                            <p>
                                A news update has been published on a project you follow:
                                <strong>${project.title}</strong>
                            </p>
                            <p>
                                <a href="${env.FRONTEND_URL}/admin/projects/${projectId}">
                                    View Update
                                </a>
                            </p>
                            <p style="font-size:12px;color:#6b7280;">
                                You are receiving this because you favourited this project.
                            </p>
                        `,
                });
            }

            console.log('[NEWS_UPDATE_HOOK] Successfully updated project news_update_at');
        } catch (error) {
            console.error('[NEWS_UPDATE_HOOK] Error updating project:', error);
        }
    });

    // Also update on news update (in case news is edited)
    action('news_updates.items.update', async ({ payload, keys, collection }, { schema, accountability }) => {
        try {
            console.log('[NEWS_UPDATE_HOOK] News update edited:', keys);

            // Get the news update to find its project_id
            const newsService = new ItemsService('news_updates', {
                schema: schema,
                accountability: accountability,
            });

            // keys is an array of IDs being updated
            for (const key of keys) {
                const newsUpdate = await newsService.readOne(key, {
                    fields: ['project', 'project']
                });

                const projectId = newsUpdate.project;

                if (!projectId) {
                    console.log('[NEWS_UPDATE_HOOK] No project_id found for news update:', key);
                    continue;
                }

                console.log('[NEWS_UPDATE_HOOK] Updating project:', projectId);

                const projectsService = new ItemsService('projects', {
                    schema: schema,
                    accountability: accountability,
                });

                await projectsService.updateOne(projectId, {
                    news_update_at: new Date().toISOString()
                });

                console.log('[NEWS_UPDATE_HOOK] Successfully updated project news_update_at');
            }
        } catch (error) {
            console.error('[NEWS_UPDATE_HOOK] Error updating project:', error);
        }
    });
};