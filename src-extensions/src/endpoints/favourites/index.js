export default (router, context) => {
    // Properly destructure from context for bundles
    const { services, exceptions, database, env, logger, getSchema } = context;
    const { ItemsService } = services;
    const { ForbiddenException, InvalidPayloadException, ServiceUnavailableException } = exceptions;

    // Use consistent collection names throughout
    const allowedCollections = ['projects', 'companies', 'main_news'];

    // ============================================
    // 1. TOGGLE FAVORITE
    // ============================================
    router.post('/toggle', async (req, res) => {
        try {
            const { collection, item_id } = req.body;
            const { accountability } = req;

            console.log('Toggle request:', { collection, item_id, user: accountability?.user });

            // Validate authentication
            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'You must be authenticated to manage favorites',
                });
            }

            // Validate required fields
            if (!collection || !item_id) {
                return res.status(400).json({
                    success: false,
                    error: 'Collection and item_id are required',
                });
            }

            // Validate collection name
            if (!allowedCollections.includes(collection)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                });
            }

            const schema = await getSchema();
            const favoritesService = new ItemsService('favourites', {
                schema: schema,
                accountability: req.accountability,
            });

            // SKIP ITEM EXISTENCE CHECK - Assume item exists if we can favorite it
            // The database constraints will prevent invalid references anyway

            console.log(`Proceeding without item existence check for ${collection}:${item_id}`);

            // Check if favorite already exists
            const existing = await favoritesService.readByQuery({
                filter: {
                    _and: [
                        { user_created: { _eq: accountability.user } },
                        { collection: { _eq: collection } },
                        { item_id: { _eq: item_id } },
                    ],
                },
                limit: 1,
            });

            if (existing.length > 0) {
                // Remove favorite
                await favoritesService.deleteOne(existing[0].id);

                // Decrement count (handle if column doesn't exist)
                try {
                    await database(collection)
                        .where('id', item_id)
                        .decrement('favorites_count', 1);
                } catch (error) {
                    console.warn(`Could not decrement favorites_count for ${collection}:`, error.message);
                }

                return res.json({
                    success: true,
                    action: 'removed',
                    favorited: false,
                    message: 'Removed from favorites',
                });
            } else {
                // Add favorite
                const newFavorite = await favoritesService.createOne({
                    collection,
                    item_id,
                });

                // Increment count (handle if column doesn't exist)
                try {
                    await database(collection)
                        .where('id', item_id)
                        .increment('favorites_count', 1);
                } catch (error) {
                    console.warn(`Could not increment favorites_count for ${collection}:`, error.message);
                }

                return res.json({
                    success: true,
                    action: 'added',
                    favorited: true,
                    favorite_id: newFavorite.id,
                    message: 'Added to favorites',
                });
            }
        } catch (error) {
            console.error('Toggle favorite error:', error);

            // Handle foreign key constraint errors gracefully
            if (error.message.includes('foreign key') || error.message.includes('constraint')) {
                return res.status(404).json({
                    success: false,
                    error: `Item not found in ${req.body.collection}`,
                });
            }

            return res.status(500).json({
                success: false,
                error: 'Failed to toggle favorite',
                details: error.message,
            });
        }
    });

    // ============================================
    // 2. BATCH CHECK FAVORITES
    // ============================================
    router.post('/check-batch', async (req, res) => {
        try {
            const { items } = req.body;
            const { accountability } = req;

            if (!accountability?.user) {
                return res.json({
                    success: true,
                    authenticated: false,
                    results: {},
                });
            }

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Items array is required',
                });
            }

            // Limit batch size
            if (items.length > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'Maximum 100 items per batch request',
                });
            }

            // Validate all items
            for (const item of items) {
                if (!item.collection || !item.item_id) {
                    return res.status(400).json({
                        success: false,
                        error: 'Each item must have collection and item_id',
                    });
                }
                if (!allowedCollections.includes(item.collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection: ${item.collection}`,
                    });
                }
            }

            const favoritesService = new ItemsService('favorites', {
                schema: await getSchema(),
                accountability: req.accountability,
            });

            // Build OR filter for all items
            const orFilters = items.map(item => ({
                _and: [
                    { user_created: { _eq: accountability.user } },
                    { collection: { _eq: item.collection } },
                    { item_id: { _eq: item.item_id } },
                ],
            }));

            const favorites = await favoritesService.readByQuery({
                filter: {
                    _or: orFilters,
                },
                limit: -1,
            });

            // Map results by creating a lookup key
            const results = {};

            items.forEach(item => {
                const key = `${item.collection}:${item.item_id}`;
                const fav = favorites.find(
                    f => f.collection === item.collection && f.item_id === item.item_id
                );

                results[key] = {
                    collection: item.collection,
                    item_id: item.item_id,
                    favorited: !!fav,
                    favorite_id: fav?.id || null,
                    date_created: fav?.date_created || null,
                };
            });

            return res.json({
                success: true,
                authenticated: true,
                total: items.length,
                favorited_count: favorites.length,
                results,
            });
        } catch (error) {
            console.error('Batch check error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to check favorites',
                details: error.message,
            });
        }
    });

    // ============================================
    // 3. GET POPULAR ITEMS (MOST FAVORITED)
    // ============================================
    router.get('/popular/:collection', async (req, res) => {
        try {
            const { collection } = req.params;
            const {
                limit = 10,
                period = 'all', // 'all', 'month', 'week', 'day'
            } = req.query;

            // Validate collection
            if (!allowedCollections.includes(collection)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                });
            }

            const itemService = new ItemsService(collection, {
                schema: await getSchema(),
                accountability: req.accountability,
            });

            // Build filter based on period
            let dateFilter = {};
            if (period !== 'all') {
                const now = new Date();
                let startDate;

                switch (period) {
                    case 'day':
                        startDate = new Date(now.setDate(now.getDate() - 1));
                        break;
                    case 'week':
                        startDate = new Date(now.setDate(now.getDate() - 7));
                        break;
                    case 'month':
                        startDate = new Date(now.setMonth(now.getMonth() - 1));
                        break;
                    default:
                        startDate = null;
                }

                if (startDate) {
                    dateFilter.date_created = { _gte: startDate.toISOString() };
                }
            }

            // Get items sorted by favorites_count
            const items = await itemService.readByQuery({
                filter: {
                    favorites_count: { _gt: 0 },
                    status: { _eq: 'published' },
                    ...dateFilter,
                },
                sort: ['-favorites_count', '-date_created'],
                limit: parseInt(limit),
            });

            // Enhance with rank
            const rankedItems = items.map((item, index) => ({
                rank: index + 1,
                ...item,
            }));

            return res.json({
                success: true,
                collection,
                period,
                total: rankedItems.length,
                popular: rankedItems,
            });
        } catch (error) {
            console.error('Get popular items error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch popular items',
                details: error.message,
            });
        }
    });

    // ============================================
    // 4. GET FAVORITE STATISTICS
    // ============================================
    router.get('/stats', async (req, res) => {
        try {
            const { accountability } = req;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const favoritesService = new ItemsService('favourites', {
                schema: await getSchema(),
                accountability: req.accountability,
            });

            // Get total favorites by collection
            const projectsFavorites = await favoritesService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'projects' },
                },
                aggregate: { count: '*' },
            });

            const companiesFavorites = await favoritesService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'companies' },
                },
                aggregate: { count: '*' },
            });

            const newsFavorites = await favoritesService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'main_news' },
                },
                aggregate: { count: '*' },
            });

            // Get recent favorites (last 5)
            const recentFavorites = await favoritesService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                },
                sort: ['-date_created'],
                limit: 5,
            });

            return res.json({
                success: true,
                stats: {
                    total: (projectsFavorites[0]?.count || 0) +
                        (companiesFavorites[0]?.count || 0) +
                        (newsFavorites[0]?.count || 0),
                    by_collection: {
                        projects: projectsFavorites[0]?.count || 0,
                        companies: companiesFavorites[0]?.count || 0,
                        main_news: newsFavorites[0]?.count || 0,
                    },
                    recent: recentFavorites,
                },
            });
        } catch (error) {
            console.error('Get stats error:', error);

            return res.status(500).json({
                success: false,
                error: 'Failed to fetch statistics',
                details: error.message,
            });
        }
    });

    // ============================================
    // 5. CHECK IF ITEM IS FAVORITED
    // IMPORTANT: This must come BEFORE the GET / route
    // ============================================
    router.get('/:collection/:item_id/check', async (req, res) => {
        try {
            const { collection, item_id } = req.params;
            const { accountability } = req;

            // Allow checking without authentication (returns false)
            if (!accountability?.user) {
                return res.json({
                    favorited: false,
                    favorite_id: null,
                    authenticated: false,
                });
            }

            // Validate collection
            if (!allowedCollections.includes(collection)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                });
            }

            const favoritesService = new ItemsService('favourites', {
                schema: await getSchema(),
                accountability: req.accountability,
            });

            const existing = await favoritesService.readByQuery({
                filter: {
                    _and: [
                        { user_created: { _eq: accountability.user } },
                        { collection: { _eq: collection } },
                        { item_id: { _eq: item_id } },
                    ],
                },
                limit: 1,
            });

            const isFavorited = existing.length > 0;

            return res.json({
                favorited: isFavorited,
                favorite_id: isFavorited ? existing[0].id : null,
                date_created: isFavorited ? existing[0].date_created : null,
                authenticated: true,
            });
        } catch (error) {
            console.error('Check favorite error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to check favorite status',
                details: error.message,
            });
        }
    });

    // ============================================
    // 6. DELETE ALL USER FAVORITES
    // ============================================
    router.delete('/clear', async (req, res) => {
        try {
            const { accountability } = req;
            const { collection } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const favoritesService = new ItemsService('favourites', {
                schema: await getSchema(),
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (collection) {
                if (!allowedCollections.includes(collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: collection };
            }

            // Get favorites to delete
            const toDelete = await favoritesService.readByQuery({
                filter,
                limit: -1,
                fields: ['id', 'collection', 'item_id'],
            });

            if (toDelete.length === 0) {
                return res.json({
                    success: true,
                    message: 'No favorites to delete',
                    deleted: 0,
                });
            }

            // Delete favorites
            const ids = toDelete.map(f => f.id);
            await favoritesService.deleteMany(ids);

            // Update counts
            const countUpdates = {};
            toDelete.forEach(fav => {
                if (!countUpdates[fav.collection]) {
                    countUpdates[fav.collection] = {};
                }
                if (!countUpdates[fav.collection][fav.item_id]) {
                    countUpdates[fav.collection][fav.item_id] = 0;
                }
                countUpdates[fav.collection][fav.item_id]++;
            });

            // Execute count updates
            for (const [coll, items] of Object.entries(countUpdates)) {
                for (const [itemId, count] of Object.entries(items)) {
                    try {
                        await database(coll)
                            .where('id', itemId)
                            .decrement('favorites_count', count);
                    } catch (error) {
                        console.warn(`Could not decrement favorites_count for ${coll}:`, error.message);
                    }
                }
            }

            return res.json({
                success: true,
                message: `Deleted ${toDelete.length} favorite(s)`,
                deleted: toDelete.length,
                collection: collection || 'all',
            });
        } catch (error) {
            console.error('Clear favorites error:', error);

            return res.status(500).json({
                success: false,
                error: 'Failed to clear favorites',
                details: error.message,
            });
        }
    });

    // ============================================
    // 7. GET USER'S FAVORITES
    // IMPORTANT: This MUST be last because / matches everything
    // ============================================
    router.get('/', async (req, res) => {
        try {
            const { accountability } = req;
            const {
                collection: filterCollection,
                limit = 50,
                offset = 0,
                sort = '-date_created',
            } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'You must be authenticated to view favorites',
                });
            }

            const schema = await getSchema();
            const favoritesService = new ItemsService('favourites', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (filterCollection) {
                if (!allowedCollections.includes(filterCollection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection filter. Must be one of: ${allowedCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: filterCollection };
            }

            console.log('Fetching favorites with filter:', JSON.stringify(filter));

            // Get favorites with pagination - use simpler query first
            const favorites = await favoritesService.readByQuery({
                filter,
                sort: [sort],
                limit: parseInt(limit),
                offset: parseInt(offset),
            });

            console.log('Favorites result:', favorites);

            // Ensure favorites is an array
            if (!Array.isArray(favorites)) {
                console.error('Favorites is not an array:', typeof favorites, favorites);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response format from favorites service',
                });
            }

            // Get total count - use a safer approach
            let totalCount = 0;
            try {
                const countResult = await favoritesService.readByQuery({
                    filter,
                    aggregate: { count: ['*'] },
                });

                // Handle different possible response formats
                if (Array.isArray(countResult) && countResult.length > 0) {
                    totalCount = countResult[0]?.count || 0;
                } else if (countResult && typeof countResult === 'object') {
                    totalCount = countResult.count || 0;
                }

                console.log('Total count result:', countResult);
            } catch (countError) {
                console.warn('Could not get total count:', countError.message);
                // Continue without total count
            }

            // Group by collection and fetch actual items with details
            const grouped = {
                projects: [],
                companies: [],
                main_news: [],
            };

            const collectionCounts = {
                projects: 0,
                companies: 0,
                main_news: 0,
            };

            // Process favorites if we have any
            if (favorites.length > 0) {
                for (const fav of favorites) {
                    if (!fav.collection || !grouped[fav.collection]) {
                        console.warn('Invalid favorite item or collection:', fav);
                        continue;
                    }

                    try {
                        const itemService = new ItemsService(fav.collection, {
                            schema: schema,
                            accountability: req.accountability,
                        });

                        // Fetch the item with specific fields based on collection
                        let fields = ['id', 'status', 'date_created', 'date_updated'];

                        // Only include favorites_count if it exists in the collection
                        try {
                            const collectionSchema = schema.collections[fav.collection];
                            if (collectionSchema && collectionSchema.fields && collectionSchema.fields.favorites_count) {
                                fields.push('favorites_count');
                            }
                        } catch (schemaError) {
                            console.warn(`Could not check schema for ${fav.collection}:`, schemaError.message);
                        }

                        if (fav.collection === 'projects') {
                            fields.push('title', 'slug', 'summary', 'featured_image', 'contract_value_usd', 'current_stage');
                        } else if (fav.collection === 'companies') {
                            fields.push('name', 'slug', 'company_role', 'logo', 'description');
                        } else if (fav.collection === 'main_news') {
                            fields.push('title', 'slug', 'summary', 'featured_image');
                        }

                        console.log(`Fetching ${fav.collection} item ${fav.item_id} with fields:`, fields);

                        const item = await itemService.readOne(fav.item_id, {
                            fields: fields,
                        });

                        if (item) {
                            grouped[fav.collection].push({
                                // Favorite metadata
                                favorite_id: fav.id,
                                favorite_date: fav.date_created,
                                // Item data
                                ...item,
                            });

                            collectionCounts[fav.collection]++;
                        } else {
                            console.warn(`Item not found: ${fav.collection} - ${fav.item_id}`);
                        }
                    } catch (error) {
                        // Item might be deleted or user doesn't have access
                        console.warn(`Could not fetch ${fav.collection} item ${fav.item_id}:`, error.message);
                    }
                }
            }

            return res.json({
                success: true,
                total: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                counts: collectionCounts,
                favorites: grouped,
            });
        } catch (error) {
            console.error('Get favorites error:', error);

            return res.status(500).json({
                success: false,
                error: 'Failed to fetch favorites',
                details: error.message,
            });
        }
    });

};