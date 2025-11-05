export default {
    id: 'favorites',
    handler: (router, { services, exceptions, database }) => {
        const { ItemsService } = services;
        const { ForbiddenException, InvalidPayloadException, ServiceUnavailableException } = exceptions;

        // ============================================
        // 1. TOGGLE FAVORITE
        // ============================================
        router.post('/toggle', async (req, res) => {
            try {
                const { collection, item_id } = req.body;
                const { accountability } = req;

                // Validate authentication
                if (!accountability?.user) {
                    throw new ForbiddenException('You must be authenticated to manage favorites');
                }

                // Validate required fields
                if (!collection || !item_id) {
                    throw new InvalidPayloadException('Collection and item_id are required');
                }

                // Validate collection name
                const allowedCollections = ['projects', 'companies', 'news'];
                if (!allowedCollections.includes(collection)) {
                    throw new InvalidPayloadException(
                        `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`
                    );
                }

                const favoritesService = new ItemsService('favorites', {
                    schema: req.schema,
                    accountability: req.accountability,
                });

                const collectionService = new ItemsService(collection, {
                    schema: req.schema,
                    accountability: req.accountability,
                });

                // Verify the item exists
                try {
                    await collectionService.readOne(item_id);
                } catch (error) {
                    return res.status(404).json({
                        success: false,
                        error: `Item not found in ${collection}`,
                    });
                }

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

                    // Decrement count
                    await database(collection)
                        .where('id', item_id)
                        .decrement('favorites_count', 1);

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

                    // Increment count
                    await database(collection)
                        .where('id', item_id)
                        .increment('favorites_count', 1);

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

                if (error instanceof ForbiddenException || error instanceof InvalidPayloadException) {
                    return res.status(error.status || 400).json({
                        success: false,
                        error: error.message,
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
        // 2. CHECK IF ITEM IS FAVORITED
        // GET /custom/favorites/check/:collection/:item_id
        // ============================================
        router.get('/check/:collection/:item_id', async (req, res) => {
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
                const allowedCollections = ['projects', 'companies', 'news'];
                if (!allowedCollections.includes(collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                    });
                }

                const favoritesService = new ItemsService('favorites', {
                    schema: req.schema,
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
        // 3. GET USER'S FAVORITES
        // GET /custom/favorites/my-favorites
        // Query params: ?collection=projects&limit=20&offset=0
        // ============================================
        router.get('/my-favorites', async (req, res) => {
            try {
                const { accountability } = req;
                const {
                    collection: filterCollection,
                    limit = 50,
                    offset = 0,
                    sort = '-date_created',
                } = req.query;

                if (!accountability?.user) {
                    throw new ForbiddenException('You must be authenticated to view favorites');
                }

                const favoritesService = new ItemsService('favorites', {
                    schema: req.schema,
                    accountability: req.accountability,
                });

                // Build filter
                const filter = {
                    user_created: { _eq: accountability.user },
                };

                if (filterCollection) {
                    const allowedCollections = ['projects', 'companies', 'news'];
                    if (!allowedCollections.includes(filterCollection)) {
                        return res.status(400).json({
                            success: false,
                            error: `Invalid collection filter. Must be one of: ${allowedCollections.join(', ')}`,
                        });
                    }
                    filter.collection = { _eq: filterCollection };
                }

                // Get favorites with pagination
                const favorites = await favoritesService.readByQuery({
                    filter,
                    sort: [sort],
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    fields: ['*'],
                });

                // Get total count
                const totalCount = await favoritesService.readByQuery({
                    filter,
                    aggregate: { count: '*' },
                });

                // Group by collection and fetch actual items with details
                const grouped = {
                    projects: [],
                    companies: [],
                    news: [],
                };

                const collectionCounts = {
                    projects: 0,
                    companies: 0,
                    news: 0,
                };

                for (const fav of favorites) {
                    if (!grouped[fav.collection]) continue;

                    try {
                        const itemService = new ItemsService(fav.collection, {
                            schema: req.schema,
                            accountability: req.accountability,
                        });

                        // Fetch the item with specific fields based on collection
                        let fields = ['id', 'status', 'date_created', 'date_updated', 'favorites_count'];

                        if (fav.collection === 'projects') {
                            fields.push('title', 'slug', 'summary', 'featured_image', 'contract_value_usd', 'current_stage');
                        } else if (fav.collection === 'companies') {
                            fields.push('name', 'slug', 'company_type', 'logo', 'description');
                        } else if (fav.collection === 'news') {
                            fields.push('title', 'slug', 'excerpt', 'featured_image', 'published_at');
                        }

                        const item = await itemService.readOne(fav.item_id, {
                            fields,
                        });

                        grouped[fav.collection].push({
                            // Favorite metadata
                            favorite_id: fav.id,
                            favorite_date: fav.date_created,
                            favorite_notes: fav.notes,
                            favorite_tags: fav.tags,
                            // Item data
                            ...item,
                        });

                        collectionCounts[fav.collection]++;
                    } catch (error) {
                        // Item might be deleted or user doesn't have access
                        console.warn(`Could not fetch ${fav.collection} item ${fav.item_id}:`, error.message);
                    }
                }

                return res.json({
                    success: true,
                    total: totalCount[0]?.count || 0,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    counts: collectionCounts,
                    favorites: grouped,
                });
            } catch (error) {
                console.error('Get favorites error:', error);

                if (error instanceof ForbiddenException) {
                    return res.status(403).json({
                        success: false,
                        error: error.message,
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: 'Failed to fetch favorites',
                    details: error.message,
                });
            }
        });

        // ============================================
        // 4. GET POPULAR ITEMS (MOST FAVORITED)
        // GET /custom/favorites/popular/:collection
        // Query params: ?limit=10&period=all
        // ============================================
        router.get('/popular/:collection', async (req, res) => {
            try {
                const { collection } = req.params;
                const {
                    limit = 10,
                    period = 'all', // 'all', 'month', 'week', 'day'
                } = req.query;

                // Validate collection
                const allowedCollections = ['projects', 'companies', 'news'];
                if (!allowedCollections.includes(collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection. Must be one of: ${allowedCollections.join(', ')}`,
                    });
                }

                const itemService = new ItemsService(collection, {
                    schema: req.schema,
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
        // 5. BATCH CHECK FAVORITES
        // POST /custom/favorites/check-batch
        // Body: { items: [{ collection, item_id }, ...] }
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
                const allowedCollections = ['projects', 'companies', 'news'];
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
                    schema: req.schema,
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
        // 6. BONUS: GET FAVORITE STATISTICS
        // GET /custom/favorites/stats
        // ============================================
        router.get('/stats', async (req, res) => {
            try {
                const { accountability } = req;

                if (!accountability?.user) {
                    throw new ForbiddenException('Authentication required');
                }

                const favoritesService = new ItemsService('favorites', {
                    schema: req.schema,
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
                        collection: { _eq: 'news' },
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
                            news: newsFavorites[0]?.count || 0,
                        },
                        recent: recentFavorites,
                    },
                });
            } catch (error) {
                console.error('Get stats error:', error);

                if (error instanceof ForbiddenException) {
                    return res.status(403).json({
                        success: false,
                        error: error.message,
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: 'Failed to fetch statistics',
                    details: error.message,
                });
            }
        });

        // ============================================
        // 7. BONUS: DELETE ALL USER FAVORITES
        // DELETE /custom/favorites/clear
        // Query params: ?collection=projects (optional)
        // ============================================
        router.delete('/clear', async (req, res) => {
            try {
                const { accountability } = req;
                const { collection } = req.query;

                if (!accountability?.user) {
                    throw new ForbiddenException('Authentication required');
                }

                const favoritesService = new ItemsService('favorites', {
                    schema: req.schema,
                    accountability: req.accountability,
                });

                // Build filter
                const filter = {
                    user_created: { _eq: accountability.user },
                };

                if (collection) {
                    const allowedCollections = ['projects', 'companies', 'news'];
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
                        await database(coll)
                            .where('id', itemId)
                            .decrement('favorites_count', count);
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

                if (error instanceof ForbiddenException) {
                    return res.status(403).json({
                        success: false,
                        error: error.message,
                    });
                }

                return res.status(500).json({
                    success: false,
                    error: 'Failed to clear favorites',
                    details: error.message,
                });
            }
        });
    },
};