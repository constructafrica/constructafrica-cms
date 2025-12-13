export default ({ action }, { services, database }) => {
    const { ItemsService } = services;

    // Hook to update project's news_update_at when news is created or updated
    action('news_updates.items.create', async ({ payload, key, collection }, { schema, accountability }) => {
        try {
            console.log('[NEWS_UPDATE_HOOK] News update created:', key);

            // Get the project_id from the created news update
            const projectId = payload.project;

            if (!projectId) {
                console.log('[NEWS_UPDATE_HOOK] No project_id found in payload');
                return;
            }

            console.log('[NEWS_UPDATE_HOOK] Updating project:', projectId);

            // Update the project's news_update_at field
            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: accountability,
            });

            await projectsService.updateOne(projectId, {
                news_update_at: new Date().toISOString()
            });

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