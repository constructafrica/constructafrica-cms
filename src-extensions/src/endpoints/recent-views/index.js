export default (router, context) => {
    // Properly destructure from context for bundles
    const {services, exceptions, database, env, logger, getSchema} = context;
    const {ItemsService} = services;
    const {ForbiddenException, InvalidPayloadException, ServiceUnavailableException} = exceptions;

    // ============================================
    // RECENT VIEWS FUNCTIONALITY
    // ============================================

    // Allowed collections for recent views
    const recentViewCollections = ['projects', 'companies', 'main_news', 'tenders'];


    // ============================================
    // 9. GET USER'S RECENT VIEWS
    // ============================================
    router.get('/', async (req, res) => {
        try {
            const { accountability } = req;
            const {
                collection: filterCollection,
                limit = 20,
                offset = 0,
            } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'You must be authenticated to view recent history',
                });
            }

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (filterCollection) {
                if (!recentViewCollections.includes(filterCollection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection filter. Must be one of: ${recentViewCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: filterCollection };
            }

            // Get recent views with pagination (sorted by most recent first)
            const recentViews = await recentViewsService.readByQuery({
                filter,
                sort: ['-date_updated', '-date_created'],
                limit: parseInt(limit),
                offset: parseInt(offset),
            });

            // Get total count
            const totalCount = await recentViewsService.readByQuery({
                filter,
                aggregate: { count: ['*'] },
            });

            // Group by collection and fetch actual items with details
            const grouped = {
                projects: [],
                companies: [],
                tenders: [],
                news: [],
            };

            const collectionCounts = {
                projects: 0,
                companies: 0,
                tenders: 0,
                news: 0,
            };

            for (const view of recentViews) {
                if (!grouped[view.collection]) continue;

                try {
                    const itemService = new ItemsService(view.collection, {
                        schema: schema,
                        accountability: req.accountability,
                    });

                    // Fetch the item with specific fields based on collection
                    let fields = ['id', 'status', 'date_created', 'date_updated'];

                    if (view.collection === 'projects') {
                        fields.push('title', 'slug', 'summary', 'featured_image', 'contract_value_usd', 'current_status.name');
                    } else if (view.collection === 'companies') {
                        fields.push('name', 'slug', 'company_role', 'logo', 'description');
                    }

                    const item = await itemService.readOne(view.item_id, {
                        fields: fields,
                    });

                    grouped[view.collection].push({
                        // View metadata
                        view_id: view.id,
                        view_date: view.date_created,
                        last_viewed: view.date_updated,
                        // Item data
                        ...item,
                    });

                    collectionCounts[view.collection]++;
                } catch (error) {
                    // Item might be deleted or user doesn't have access
                    console.warn(`Could not fetch ${view.collection} item ${view.item_id}:`, error.message);

                    // Optionally remove the recent view if item no longer exists
                    try {
                        await recentViewsService.deleteOne(view.id);
                    } catch (deleteError) {
                        console.warn(`Could not delete orphaned recent view ${view.id}:`, deleteError.message);
                    }
                }
            }

            return res.json({
                success: true,
                total: totalCount[0]?.count || 0,
                limit: parseInt(limit),
                offset: parseInt(offset),
                counts: collectionCounts,
                recent_views: grouped,
            });
        } catch (error) {
            console.error('Get recent views error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recent views',
                details: error.message,
            });
        }
    });

    router.get('/:collection', async (req, res) => {
        try {
            const { accountability } = req;
            const { collection } = req.params; // Get collection from URL params
            const {
                limit = 100,
                offset = 0,
                sort = '-date_created',
            } = req.query;

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'You must be authenticated to view views',
                });
            }

            // Validate collection parameter
            if (!recentViewCollections.includes(collection)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid collection. Must be one of: ${recentViewCollections.join(', ')}`,
                });
            }

            const schema = await getSchema();
            const recentViewService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter - only filter by user and collection from URL
            const filter = {
                _and: [
                    { user_created: { _eq: accountability.user } },
                    { collection: { _eq: collection } },
                ],
            };

            console.log('Fetching views with filter:', JSON.stringify(filter));

            // Get views with pagination
            const views = await recentViewService.readByQuery({
                filter,
                sort: [sort],
                limit: parseInt(limit),
                offset: parseInt(offset),
                fields: ['*'] // Ensure we get all favorite fields
            });

            // Ensure views is an array
            if (!Array.isArray(views)) {
                console.error('Recent views is not an array:', typeof views, views);
                return res.status(500).json({
                    success: false,
                    error: 'Invalid response format from views service',
                });
            }

            // Get total count
            let totalCount = 0;
            try {
                const countResult = await recentViewService.readByQuery({
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
                totalCount = views.length; // Fallback to current result count
            }

            // Process views and fetch actual items with standardized format
            const results = [];

            if (views.length > 0) {
                for (const fav of views) {
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
                            },
                            'tenders': {
                                title: 'title',
                                image: 'featured_image',
                                summary: 'summary',
                                slug: 'slug',
                                date: 'date_created',
                                countries: 'countries.countries_id.*',
                                sectors: 'sectors.sectors_id.*'
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
                                        };
                                    })
                                    .filter(Boolean);
                            };

                            // Helper function to safely get field values
                            const getFieldValue = (obj, path) => {
                                if (!path) return undefined;
                                return path.split('.').reduce((acc, part) => acc?.[part], obj);
                            };

                            // Process relationships for different collection types
                            let countries = [];
                            let sectors = [];
                            let regions = [];

                            if (fav.collection === 'projects' || fav.collection === 'tenders' || fav.collection === 'companies') {
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
                                    current_status: item.current_status,
                                    contract_value_usd: item.contract_value_usd,
                                    location: item.location,
                                    countries: countries,
                                    sectors: sectors,
                                    regions: regions,
                                }),
                                ...(fav.collection === 'companies' && {
                                    company_role: item.company_role,
                                    employees: item.employees,
                                    projects_completed: item.projects_completed,
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
                    }
                }
            }

            console.log('Final results count:', results.length);

            return res.json({
                success: true,
                collection: collection,
                total: totalCount,
                limit: parseInt(limit),
                offset: parseInt(offset),
                data: results,
            });
        } catch (error) {
            console.error('Get views error:', error);

            return res.status(500).json({
                success: false,
                error: 'Failed to fetch views',
                details: error.message,
            });
        }
    });

// ============================================
// 10. CLEAR RECENT VIEWS
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

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Build filter
            const filter = {
                user_created: { _eq: accountability.user },
            };

            if (collection) {
                if (!recentViewCollections.includes(collection)) {
                    return res.status(400).json({
                        success: false,
                        error: `Invalid collection. Must be one of: ${recentViewCollections.join(', ')}`,
                    });
                }
                filter.collection = { _eq: collection };
            }

            // Get views to delete
            const toDelete = await recentViewsService.readByQuery({
                filter,
                limit: -1,
                fields: ['id'],
            });

            if (toDelete.length === 0) {
                return res.json({
                    success: true,
                    message: 'No recent views to delete',
                    deleted: 0,
                });
            }

            // Delete views
            const ids = toDelete.map(view => view.id);
            await recentViewsService.deleteMany(ids);

            return res.json({
                success: true,
                message: `Deleted ${toDelete.length} recent view(s)`,
                deleted: toDelete.length,
                collection: collection || 'all',
            });
        } catch (error) {
            console.error('Clear recent views error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to clear recent views',
                details: error.message,
            });
        }
    });

// ============================================
// 11. GET RECENT VIEWS STATISTICS
// ============================================
    router.get('/stats', async (req, res) => {
        try {
            const { accountability } = req;
            const { period = 'week' } = req.query; // 'day', 'week', 'month'

            if (!accountability?.user) {
                return res.status(403).json({
                    success: false,
                    error: 'Authentication required',
                });
            }

            const schema = await getSchema();
            const recentViewsService = new ItemsService('recent_views', {
                schema: schema,
                accountability: req.accountability,
            });

            // Calculate date range
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
                    startDate = new Date(now.setDate(now.getDate() - 7));
            }

            // Get view counts by collection for the period
            const projectsViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'projects' },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: { count: ['*'] },
            });

            const companiesViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    collection: { _eq: 'companies' },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: { count: ['*'] },
            });

            // Get most frequently viewed items
            const frequentViews = await recentViewsService.readByQuery({
                filter: {
                    user_created: { _eq: accountability.user },
                    date_created: { _gte: startDate.toISOString() },
                },
                aggregate: {
                    groupBy: ['collection', 'item_id'],
                    count: ['*'],
                },
                sort: ['-count'],
                limit: 5,
            });

            return res.json({
                success: true,
                period,
                stats: {
                    total: (projectsViews[0]?.count || 0) + (companiesViews[0]?.count || 0),
                    by_collection: {
                        projects: projectsViews[0]?.count || 0,
                        companies: companiesViews[0]?.count || 0,
                    },
                    start_date: startDate.toISOString(),
                    frequent_items: frequentViews,
                },
            });
        } catch (error) {
            console.error('Get recent views stats error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch recent views statistics',
                details: error.message,
            });
        }
    });
};