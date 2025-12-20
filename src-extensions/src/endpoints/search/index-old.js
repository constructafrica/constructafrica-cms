export default (router, context) => {
    const { services, exceptions, database, env, logger, getSchema } = context;
    const { ItemsService } = services;

    // ============================================
    // SEARCHABLE COLLECTIONS CONFIGURATION
    // ============================================
    const searchableCollections = {
        projects: {
            fields: ['title', 'summary', 'id', 'slug', 'status', 'date_created'],
            searchFields: ['title', 'summary'],
            displayFields: {
                id: "id",
                title: 'title',
                type: 'project',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 1.0
        },
        companies: {
            fields: ['name', 'description', 'id', 'slug', 'status', 'date_created'],
            searchFields: ['name', 'description'],
            displayFields: {
                id: "id",
                title: 'name',
                type: 'company',
                summary: 'description',
                slug: 'slug'
            },
            weight: 0.9
        },
        main_news: {
            fields: ['title', 'summary', 'id', 'slug', 'status', 'date_created'],
            searchFields: ['title', 'summary'],
            displayFields: {
                id: "id",
                title: 'title',
                type: 'news',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.8
        },
        tenders: {
            fields: ['title', 'summary', 'slug', 'id', 'status', 'date_created'],
            searchFields: ['title', 'summary'],
            displayFields: {
                id: "id",
                title: 'title',
                type: 'tenders',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.7
        },
        experts_analysts: {
            fields: ['title', 'id', 'slug', 'bio', 'status', 'date_created'],
            searchFields: ['title', 'bio'],
            displayFields: {
                id: "id",
                title: 'title',
                type: 'experts_analysts',
                summary: 'bio',
                slug: 'slug'
            },
            weight: 0.6
        },
        blog: {
            fields: ['title', 'summary', 'id', 'slug', 'status', 'date_created'],
            searchFields: ['title', 'summary'],
            displayFields: {
                id: "id",
                title: 'title',
                type: 'blog',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.5
        }
    };

    // ============================================
    // GLOBAL SEARCH ENDPOINT
    // ============================================
    router.get('/', async (req, res) => {
        try {
            const {
                q,
                collections,
                limit = 20,
                offset = 0,
                include_total = false
            } = req.query;

            const { accountability } = req;

            // Validate search query
            if (!q || q.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Search query (q) is required',
                });
            }

            const searchQuery = q.trim();

            // Determine which collections to search
            let collectionsToSearch = Object.keys(searchableCollections);
            if (collections) {
                const requestedCollections = collections.split(',').map(c => c.trim());
                collectionsToSearch = requestedCollections.filter(collection =>
                    searchableCollections[collection]
                );

                if (collectionsToSearch.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: `No valid collections specified. Available: ${Object.keys(searchableCollections).join(', ')}`,
                    });
                }
            }

            console.log(`[SEARCH] Query: "${searchQuery}" | Collections:`, collectionsToSearch);

            const schema = await getSchema();
            const results = {
                query: searchQuery,
                total_results: 0,
                collections_searched: collectionsToSearch,
                all_results: []
            };

            // Search each collection in parallel
            const searchPromises = collectionsToSearch.map(collection =>
                searchCollection(collection, searchQuery, parseInt(limit), parseInt(offset), schema, accountability)
            );

            const collectionResults = await Promise.allSettled(searchPromises);

            // Process results
            collectionResults.forEach((result, index) => {
                const collection = collectionsToSearch[index];

                if (result.status === 'fulfilled') {
                    results.total_results += result.value.items.length;

                    console.log(`[SEARCH] ${collection}: Found ${result.value.items.length} items (Total: ${result.value.total})`);

                    result.value.items.forEach(item => {
                        results.all_results.push({
                            ...item,
                            collection: collection,
                            collection_weight: searchableCollections[collection].weight
                        });
                    });
                } else {
                    console.error(`[SEARCH ERROR] ${collection}:`, result.reason);
                }
            });

            // Sort all results by relevance
            results.all_results.sort((a, b) => {
                if (a.collection_weight !== b.collection_weight) {
                    return b.collection_weight - a.collection_weight;
                }
                if (a._score !== undefined && b._score !== undefined) {
                    return b._score - a._score;
                }
                return 0;
            });

            // Get total counts if requested
            let totalCounts = null;
            if (include_total === 'true') {
                totalCounts = await getTotalCounts(collectionsToSearch, searchQuery, schema, accountability);
            }

            console.log(`[SEARCH] Total results: ${results.total_results}`);

            return res.json({
                success: true,
                total: totalCounts,
                limit: parseInt(limit),
                offset: parseInt(offset),
                data: results.all_results
            });

        } catch (error) {
            console.error('[SEARCH] Global search error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to perform search',
                details: error.message,
            });
        }
    });

    router.get('/v2', async (req, res) => {
        try {
            const {
                q,
                collections,
                limit = 20,
                offset = 0,
                include_total = false
            } = req.query;

            const { accountability } = req;

            // Validate search query
            if (!q || q.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Search query (q) is required',
                });
            }

            const searchQuery = q.trim();

            // Determine which collections to search
            let collectionsToSearch = Object.keys(searchableCollections);
            if (collections) {
                const requestedCollections = collections.split(',').map(c => c.trim());
                collectionsToSearch = requestedCollections.filter(collection =>
                    searchableCollections[collection]
                );

                if (collectionsToSearch.length === 0) {
                    return res.status(400).json({
                        success: false,
                        error: `No valid collections specified. Available: ${Object.keys(searchableCollections).join(', ')}`,
                    });
                }
            }

            console.log(`[SEARCH] Query: "${searchQuery}" | Collections:`, collectionsToSearch);

            const schema = await getSchema();
            const results = {
                query: searchQuery,
                total_results: 0,
                collections_searched: collectionsToSearch,
                all_results: []
            };

            // Search each collection in parallel
            const searchPromises = collectionsToSearch.map(collection =>
                searchCollection(collection, searchQuery, parseInt(limit), parseInt(offset), schema, accountability)
            );

            const collectionResults = await Promise.allSettled(searchPromises);

            // Process results
            collectionResults.forEach((result, index) => {
                const collection = collectionsToSearch[index];

                if (result.status === 'fulfilled') {
                    results.total_results += result.value.items.length;

                    console.log(`[SEARCH] ${collection}: Found ${result.value.items.length} items (Total: ${result.value.total})`);

                    result.value.items.forEach(item => {
                        results.all_results.push({
                            ...item,
                            collection: collection,
                            collection_weight: searchableCollections[collection].weight
                        });
                    });
                } else {
                    console.error(`[SEARCH ERROR] ${collection}:`, result.reason);
                }
            });

            // Sort all results by relevance
            results.all_results.sort((a, b) => {
                if (a.collection_weight !== b.collection_weight) {
                    return b.collection_weight - a.collection_weight;
                }
                if (a._score !== undefined && b._score !== undefined) {
                    return b._score - a._score;
                }
                return 0;
            });

            // Get total counts if requested
            let totalCounts = null;
            if (include_total === 'true') {
                totalCounts = await getTotalCounts(collectionsToSearch, searchQuery, schema, accountability);
            }

            console.log(`[SEARCH] Total results: ${results.total_results}`);

            return res.json({
                success: true,
                total: totalCounts,
                limit: parseInt(limit),
                offset: parseInt(offset),
                data: results.all_results
            });

        } catch (error) {
            console.error('[SEARCH] Global search error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to perform search',
                details: error.message,
            });
        }
    });

    // ============================================
    // HELPER FUNCTIONS
    // ============================================

    async function searchCollection(collection, query, limit, offset, schema, accountability) {
        try {
            const config = searchableCollections[collection];
            const service = new ItemsService(collection, {
                schema: schema,
                accountability: accountability,
            });

            // Build search filter with case-insensitive partial matching
            const searchFilter = {
                _or: config.searchFields.map(field => ({
                    [field]: { _icontains: query }
                }))
            };

            // Try with status filter first
            let filter = {
                _and: [
                    searchFilter,
                    { status: { _eq: 'published' } }
                ]
            };

            console.log(`[SEARCH] ${collection} filter:`, JSON.stringify(filter, null, 2));

            let items = await service.readByQuery({
                filter: filter,
                limit: limit,
                offset: offset,
                fields: config.fields,
                sort: ['-date_created']
            });

            console.log(`[SEARCH] ${collection} found ${items.length} items with status filter`);

            // If no results, try without status filter (for debugging)
            if (items.length === 0) {
                console.log(`[SEARCH] ${collection} - Trying without status filter...`);
                items = await service.readByQuery({
                    filter: searchFilter,
                    limit: limit,
                    offset: offset,
                    fields: config.fields,
                    sort: ['-date_created']
                });
                console.log(`[SEARCH] ${collection} found ${items.length} items without status filter`);
            }

            // Standardize the response format
            const standardizedItems = items.map(item => {
                const standardized = {
                    id: item.id,
                    title: getFieldValue(item, config.displayFields.title),
                    type: config.displayFields.type,
                    image: getFieldValue(item, config.displayFields.image),
                    summary: getFieldValue(item, config.displayFields.summary),
                    slug: getFieldValue(item, config.displayFields.slug),
                    date_created: item.date_created,
                    status: item.status // Include status for debugging
                };

                console.log(`[SEARCH] ${collection} item:`, standardized.title, `(status: ${standardized.status})`);

                return standardized;
            });

            // Get total count
            const totalResult = await service.readByQuery({
                filter: filter,
                aggregate: { count: ['*'] },
                limit: 1
            });

            const total = totalResult[0]?.count || 0;

            return {
                items: standardizedItems,
                total: total,
                limit: limit,
                offset: offset
            };

        } catch (error) {
            console.error(`[SEARCH ERROR] ${collection}:`, error);
            throw error;
        }
    }

    async function getTotalCounts(collections, query, schema, accountability) {
        const counts = {};

        const countPromises = collections.map(async (collection) => {
            try {
                const config = searchableCollections[collection];
                const service = new ItemsService(collection, {
                    schema: schema,
                    accountability: accountability,
                });

                const searchFilter = {
                    _or: config.searchFields.map(field => ({
                        [field]: { _icontains: query }
                    }))
                };

                const filter = {
                    _and: [
                        searchFilter,
                        { status: { _eq: 'published' } }
                    ]
                };

                const result = await service.readByQuery({
                    filter: filter,
                    aggregate: { count: ['*'] },
                    limit: 1
                });

                counts[collection] = result[0]?.count || 0;
            } catch (error) {
                console.error(`[SEARCH ERROR] Getting count for ${collection}:`, error);
                counts[collection] = 0;
            }
        });

        await Promise.allSettled(countPromises);
        return counts;
    }

    function getFieldValue(item, fieldPath) {
        if (!fieldPath || !item) return undefined;

        try {
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
            console.warn(`[SEARCH] Error getting field ${fieldPath}:`, error);
            return undefined;
        }
    }
};