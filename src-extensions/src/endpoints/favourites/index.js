export default (router, context) => {
    // Properly destructure from context for bundles
    const { services, exceptions, database, env, logger, getSchema } = context;
    const { ItemsService } = services;
    const { ForbiddenException, InvalidPayloadException, ServiceUnavailableException } = exceptions;

    // Use consistent collection names throughout
    const allowedCollections = ['projects', 'companies', 'main_news', 'tenders', 'blog', 'experts_analysts'];

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

    router.get('/', async (req, res) => {
        try {
            const { accountability } = req;
            const {
                collection: filterCollection,
                limit = 100,
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

            // Get favorites with pagination
            const favorites = await favoritesService.readByQuery({
                filter,
                sort: [sort],
                limit: parseInt(limit),
                offset: parseInt(offset),
                fields: ['*'] // Ensure we get all favorite fields
            });

            console.log('Favorites result count:', favorites.length);

            // Ensure favorites is an array
            if (!Array.isArray(favorites)) {
                console.error('Favorites is not an array:', typeof favorites, favorites);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response format from favorites service',
                });
            }

            // Get total count
            let totalCount = 0;
            try {
                const countResult = await favoritesService.readByQuery({
                    filter,
                    aggregate: { count: ['*'] },
                });

                if (Array.isArray(countResult) && countResult.length > 0) {
                    totalCount = countResult[0]?.count || 0;
                } else if (countResult && typeof countResult === 'object') {
                    totalCount = countResult.count || 0;
                }
                console.log('Total count:', totalCount);
            } catch (countError) {
                console.warn('Could not get total count:', countError.message);
                totalCount = favorites.length; // Fallback to current result count
            }

            // Process favorites and fetch actual items with standardized format
            const results = [];
            const collectionCounts = {
                projects: 0,
                companies: 0,
                main_news: 0,
                projects_tenders: 0,
                experts_analysts: 0,
                blog: 0
            };

            if (favorites.length > 0) {
                for (const fav of favorites) {
                    if (!fav.collection || !fav.item_id) {
                        console.warn('Invalid favorite item:', fav);
                        continue;
                    }

                    try {
                        const itemService = new ItemsService(fav.collection, {
                            schema: schema,
                            accountability: req.accountability,
                        });

                        // Define fields based on collection type with standardized field mapping
                        let fields = ['id', 'status'];

                        // Collection-specific field mapping
                        const fieldMappings = {
                            'projects': {
                                title: 'title',
                                image: 'featured_image',
                                summary: 'summary',
                                slug: 'slug',
                                date: 'date_created',
                                current_stage: 'current_stage',
                                current_status: 'current_status.name',
                                contract_value_usd: 'contract_value_usd',
                                location: 'location',
                                // Additional fields for projects
                                countries: 'countries.countries_id.*',
                                sectors: 'sectors.sectors_id.*',
                                regions: 'regions.regions_id.*'
                            },
                            'companies': {
                                title: 'name',
                                image: 'logo',
                                summary: 'description',
                                slug: 'slug',
                                date: 'date_created',
                                company_role: 'company_role',
                                // Additional fields for companies
                                countries: 'countries.countries_id.*',
                                sectors: 'sectors.sectors_id.*'
                            },
                            'main_news': {
                                title: 'title',
                                image: 'featured_image',
                                summary: 'summary',
                                slug: 'slug',
                                date: 'date_created',
                                category: 'category_id',
                                author: 'author_id'
                            },
                            'tenders': {
                                title: 'title',
                                image: 'featured_image',
                                summary: 'summary',
                                slug: 'slug',
                                date: 'date_created',
                                tender_type: 'tender_type',
                                // Additional fields for tenders
                                countries: 'countries.countries_id.*',
                                sectors: 'sectors.sectors_id.*'
                            },
                            'experts_analysts': {
                                title: 'name',
                                image: 'photo',
                                summary: 'bio',
                                slug: 'slug',
                                date: 'date_created',
                                title_role: 'title',
                                expertise: 'expertise'
                            },
                            'blog': {
                                title: 'title',
                                image: 'featured_image',
                                summary: 'summary',
                                slug: 'slug',
                                date: 'date_created',
                                category: 'category',
                                author: 'author'
                            }
                        };

                        // Add collection-specific fields
                        const mapping = fieldMappings[fav.collection];
                        if (mapping) {
                            // Add all fields from mapping (remove duplicates)
                            const additionalFields = Object.values(mapping);
                            fields = [...new Set([...fields, ...additionalFields])];
                        }

                        console.log(`Fetching ${fav.collection} item ${fav.item_id} with fields:`, fields);

                        const item = await itemService.readOne(fav.item_id, {
                            fields: fields,
                        });

                        if (item) {
                            // Helper function to flatten M2M relationships
                            const flattenRelationships = (relationArray, idField = 'id') => {
                                if (!relationArray || !Array.isArray(relationArray)) return [];

                                return relationArray
                                    .map(relationItem => {
                                        const relatedObj = relationItem[`${idField}_id`] || relationItem;
                                        if (!relatedObj || !relatedObj.id) return null;

                                        return {
                                            id: relatedObj.id,
                                            name: relatedObj.name || 'Unnamed',
                                            slug: relatedObj.slug,
                                            ...(relatedObj.flag && { flag: relatedObj.flag }),
                                            ...(relatedObj.code && { code: relatedObj.code }),
                                            ...(relatedObj.icon && { icon: relatedObj.icon }),
                                            ...(relatedObj.color && { color: relatedObj.color })
                                        };
                                    })
                                    .filter(Boolean);
                            };

                            // Process relationships for different collection types
                            let countries = [];
                            let sectors = [];
                            let regions = [];

                            if (fav.collection === 'projects' || fav.collection === 'projects_tenders' || fav.collection === 'companies') {
                                countries = flattenRelationships(item.countries, 'countries');
                                sectors = flattenRelationships(item.sectors, 'sectors');

                                if (fav.collection === 'projects') {
                                    regions = flattenRelationships(item.regions, 'regions');
                                }
                            }

                            // Transform featured_image to include full URLs
                            let imageData = getFieldValue(item, mapping?.image);
                            if (imageData && typeof imageData === 'object' && imageData.id) {
                                imageData = {
                                    id: imageData.id,
                                    url: `${process.env.PUBLIC_URL}/assets/${imageData.id}`,
                                    thumbnail_url: `${process.env.PUBLIC_URL}/assets/${imageData.id}?width=400&height=300&fit=cover`,
                                    title: imageData.title,
                                    ...imageData
                                };
                            }

                            // Create standardized response object
                            const standardizedItem = {
                                id: item.id,
                                collection: fav.collection,
                                favorite_id: fav.id,
                                favorite_date: fav.date_created,
                                title: getFieldValue(item, mapping?.title),
                                image: imageData,
                                summary: getFieldValue(item, mapping?.summary),
                                slug: getFieldValue(item, mapping?.slug),
                                status: item.status,
                                date_created: getFieldValue(item, mapping?.date),
                                // Collection-specific additional fields
                                ...(fav.collection === 'projects' && {
                                    current_stage: item.current_stage,
                                    current_status: item.current_status,
                                    contract_value_usd: item.contract_value_usd,
                                    location: item.location,
                                    countries: countries,
                                    sectors: sectors,
                                    regions: regions,
                                }),
                                ...(fav.collection === 'companies' && {
                                    company_role: item.company_role,
                                    countries: countries,
                                    sectors: sectors,
                                }),
                                ...(fav.collection === 'tenders' && {
                                    countries: countries,
                                    sectors: sectors,
                                }),
                                ...(fav.collection === 'main_news' && {
                                    category: item.is_trending ? 'Trending News' : 'Main News',
                                }),
                                ...(fav.collection === 'experts_analysts' && {
                                    title_role: item.title,
                                }),
                                ...(fav.collection === 'blog' && {
                                }),
                                // Statistics for relationships
                                ...((countries.length > 0 || sectors.length > 0 || regions.length > 0) && {
                                    stats: {
                                        ...(countries.length > 0 && { countries_count: countries.length }),
                                        ...(sectors.length > 0 && { sectors_count: sectors.length }),
                                        ...(regions.length > 0 && { regions_count: regions.length })
                                    }
                                })
                            };

                            // Clean up undefined fields
                            Object.keys(standardizedItem).forEach(key => {
                                if (standardizedItem[key] === undefined) {
                                    delete standardizedItem[key];
                                }
                            });

                            results.push(standardizedItem);
                            collectionCounts[fav.collection]++;

                            console.log(`Added ${fav.collection} item to results:`, standardizedItem.title);
                        } else {
                            console.warn(`Item not found: ${fav.collection} - ${fav.item_id}`);
                        }
                    } catch (error) {
                        console.warn(`Could not fetch ${fav.collection} item ${fav.item_id}:`, error.message);

                        // Even if we can't fetch the item, we can still return basic favorite info
                        results.push({
                            id: fav.item_id,
                            collection: fav.collection,
                            favorite_id: fav.id,
                            favorite_date: fav.date_created,
                            title: `Item ${fav.item_id}`,
                            status: 'unavailable',
                            error: 'Item could not be loaded'
                        });
                        collectionCounts[fav.collection]++;
                    }
                }
            }

            // Group results by collection for the response
            const grouped = {
                projects: results.filter(item => item.collection === 'projects'),
                companies: results.filter(item => item.collection === 'companies'),
                news: results.filter(item => item.collection === 'main_news'),
                tenders: results.filter(item => item.collection === 'projects_tenders'),
                opinions: results.filter(item => item.collection === 'experts_analysts'),
                blog: results.filter(item => item.collection === 'blog')
            };

            console.log('Final results count:', results.length);
            console.log('Collection counts:', collectionCounts);

            return res.json({
                success: true,
                total: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                counts: collectionCounts,
                data: results,
                group: grouped,
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

    // Helper function to safely get nested field values
    function getFieldValue(item, fieldPath) {
        if (!fieldPath || !item) return undefined;

        try {
            // Handle nested fields (e.g., 'featured_image.id')
            const fields = fieldPath.split('.');
            let value = item;

            for (const field of fields) {
                if (value && typeof value === 'object' && field in value) {
                    value = value[field];
                } else {
                    return undefined;
                }
            }

            return value;
        } catch (error) {
            console.warn(`Error getting field ${fieldPath}:`, error);
            return undefined;
        }
    }

};