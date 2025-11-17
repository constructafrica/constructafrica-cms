export default (router, context) => {
    // Properly destructure from context for bundles
    const { services, exceptions, database, env, logger, getSchema } = context;
    const { ItemsService } = services;
    const { ForbiddenException, InvalidPayloadException, ServiceUnavailableException } = exceptions;

// ============================================
// GLOBAL SEARCH ENDPOINT
// ============================================

    // Define searchable collections and their configurations
    const searchableCollections = {
        projects: {
            fields: ['title', 'summary',],
            searchFields: ['title', 'summary'],
            displayFields: {
                title: 'title',
                type: 'project',
                image: 'featured_image',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 1.0
        },
        companies: {
            fields: ['name', 'description'],
            searchFields: ['name', 'description'],
            displayFields: {
                title: 'name',
                type: 'company',
                image: 'logo',
                summary: 'description',
                slug: 'slug'
            },
            weight: 0.9
        },
        main_news: {
            fields: ['title', 'summary'],
            searchFields: ['title', 'summary'],
            displayFields: {
                title: 'title',
                type: 'news',
                image: 'featured_image',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.8
        },
        projects_tenders: {
            fields: ['title', 'summary'],
            searchFields: ['title', 'summary'],
            displayFields: {
                title: 'title',
                type: 'tenders',
                image: 'featured_image',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.7
        },
        experts_analysts: {
            fields: ['name', 'title'],
            searchFields: ['name', 'title'],
            displayFields: {
                title: 'name',
                type: 'opinions',
                image: 'photo',
                summary: 'bio',
                slug: 'slug'
            },
            weight: 0.6
        },
        blog: {
            fields: ['title', 'summary'],
            searchFields: ['title', 'summary'],
            displayFields: {
                title: 'title',
                type: 'blog',
                image: 'featured_image',
                summary: 'summary',
                slug: 'slug'
            },
            weight: 0.5
        }
    };

    // ============================================
    // 1. GLOBAL SEARCH ENDPOINT
    // ============================================
    router.get('/', async (req, res) => {
        try {
            const {
                q, // search query
                collections, // specific collections to search (comma separated)
                limit = 20, // results per collection
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

            console.log(`Global search for: "${searchQuery}" in collections:`, collectionsToSearch);

            const schema = await getSchema();
            const results = {
                query: searchQuery,
                total_results: 0,
                collections_searched: collectionsToSearch,
                results_by_collection: {},
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
                    // results.results_by_collection[collection] = result.value;
                    results.total_results += result.value.items.length;

                    // Add collection info to each item and add to all_results
                    result.value.items.forEach(item => {
                        results.all_results.push({
                            ...item,
                            collection: collection,
                            collection_weight: searchableCollections[collection].weight
                        });
                    });
                } else {
                    console.error(`Error searching ${collection}:`, result.reason);
                    results.results_by_collection[collection] = {
                        items: [],
                        total: 0,
                        error: result.reason.message
                    };
                }
            });

            // Sort all results by relevance (collection weight and search relevance)
            results.all_results.sort((a, b) => {
                // First by collection weight
                if (a.collection_weight !== b.collection_weight) {
                    return b.collection_weight - a.collection_weight;
                }
                // Then by item score if available
                if (a._score !== undefined && b._score !== undefined) {
                    return b._score - a._score;
                }
                return 0;
            });

            // If include_total is true, get total counts (this can be slow for large datasets)
            if (include_total === 'true') {
                const totalCounts = await getTotalCounts(collectionsToSearch, searchQuery, schema, accountability);
                results.total_counts = totalCounts;
            }

            return res.json({
                success: true,
                total: results.total_counts,
                limit: parseInt(limit),
                offset: parseInt(offset),
                // counts: collectionCounts,
                data: results.all_results
            });

        } catch (error) {
            console.error('Global search error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to perform search',
                details: error.message,
            });
        }
    });

    // ============================================
    // 2. ADVANCED SEARCH WITH FILTERS
    // ============================================
    router.post('/advanced', async (req, res) => {
        try {
            const {
                query,
                collections = Object.keys(searchableCollections),
                filters = {},
                limit = 20,
                offset = 0,
                sort = 'relevance' // relevance, newest, oldest
            } = req.body;

            const { accountability } = req;

            if (!query || query.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Search query is required',
                });
            }

            const searchQuery = query.trim();
            const validCollections = collections.filter(collection =>
                searchableCollections[collection]
            );

            if (validCollections.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: `No valid collections specified. Available: ${Object.keys(searchableCollections).join(', ')}`,
                });
            }

            const schema = await getSchema();
            const results = {
                query: searchQuery,
                filters: filters,
                total_results: 0,
                collections_searched: validCollections,
                results_by_collection: {},
                all_results: []
            };

            // Search each collection with filters
            const searchPromises = validCollections.map(collection =>
                searchCollectionWithFilters(collection, searchQuery, filters[collection], parseInt(limit), parseInt(offset), sort, schema, accountability)
            );

            const collectionResults = await Promise.allSettled(searchPromises);

            // Process results
            collectionResults.forEach((result, index) => {
                const collection = validCollections[index];

                if (result.status === 'fulfilled') {
                    results.results_by_collection[collection] = result.value;
                    results.total_results += result.value.items.length;

                    result.value.items.forEach(item => {
                        results.all_results.push({
                            ...item,
                            collection: collection,
                            collection_weight: searchableCollections[collection].weight
                        });
                    });
                } else {
                    console.error(`Error searching ${collection}:`, result.reason);
                    results.results_by_collection[collection] = {
                        items: [],
                        total: 0,
                        error: result.reason.message
                    };
                }
            });

            // Sort all results
            if (sort === 'relevance') {
                results.all_results.sort((a, b) => {
                    if (a.collection_weight !== b.collection_weight) {
                        return b.collection_weight - a.collection_weight;
                    }
                    if (a._score !== undefined && b._score !== undefined) {
                        return b._score - a._score;
                    }
                    return 0;
                });
            } else if (sort === 'newest') {
                results.all_results.sort((a, b) => new Date(b.date_created || b.date) - new Date(a.date_created || a.date));
            } else if (sort === 'oldest') {
                results.all_results.sort((a, b) => new Date(a.date_created || a.date) - new Date(b.date_created || b.date));
            }

            return res.json({
                success: true,
                search: results
            });

        } catch (error) {
            console.error('Advanced search error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to perform advanced search',
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

            // Build search filter
            const searchFilter = {
                _or: config.searchFields.map(field => ({
                    [field]: { _icontains: query }
                }))
            };

            // Add status filter for published items only
            const filter = {
                _and: [
                    searchFilter,
                    { status: { _eq: 'published' } }
                ]
            };

            const items = await service.readByQuery({
                filter: filter,
                limit: limit,
                offset: offset,
                fields: config.fields,
                sort: ['-date_created'] // Default sort by newest
            });

            // Standardize the response format
            const standardizedItems = items.map(item => ({
                id: item.id,
                title: getFieldValue(item, config.displayFields.title),
                type: config.displayFields.type,
                image: getFieldValue(item, config.displayFields.image),
                summary: getFieldValue(item, config.displayFields.summary),
                slug: getFieldValue(item, config.displayFields.slug),
                date_created: item.date_created,
                // date_updated: item.date_updated,
                // status: item.status,
                // Include search highlights
                // _highlight: getSearchHighlights(item, query, config.searchFields)
            }));

            // Get total count for this collection
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
            console.error(`Error searching ${collection}:`, error);
            throw error;
        }
    }

    async function searchCollectionWithFilters(collection, query, filters, limit, offset, sort, schema, accountability) {
        try {
            const config = searchableCollections[collection];
            const service = new ItemsService(collection, {
                schema: schema,
                accountability: accountability,
            });

            // Build search filter
            const searchFilter = {
                _or: config.searchFields.map(field => ({
                    [field]: { _icontains: query }
                }))
            };

            // Combine search filter with collection-specific filters
            const filterConditions = [
                searchFilter,
                { status: { _eq: 'published' } }
            ];

            if (filters && Object.keys(filters).length > 0) {
                Object.entries(filters).forEach(([field, value]) => {
                    if (value) {
                        filterConditions.push({ [field]: { _eq: value } });
                    }
                });
            }

            const filter = {
                _and: filterConditions
            };

            // Build sort based on parameter
            let sortField = ['-date_created']; // default
            if (sort === 'relevance') {
                // For relevance, we might want to sort by a combination of factors
                // This is a simple implementation - you might want to enhance this
                sortField = ['-date_created'];
            }

            const items = await service.readByQuery({
                filter: filter,
                limit: limit,
                offset: offset,
                fields: config.fields,
                sort: sortField
            });

            // Standardize the response format
            const standardizedItems = items.map(item => ({
                id: item.id,
                title: getFieldValue(item, config.displayFields.title),
                type: getFieldValue(item, config.displayFields.type),
                image: getFieldValue(item, config.displayFields.image),
                summary: getFieldValue(item, config.displayFields.summary),
                slug: getFieldValue(item, config.displayFields.slug),
                date_created: item.date_created,
                date_updated: item.date_updated,
                status: item.status,
                _highlight: getSearchHighlights(item, query, config.searchFields)
            }));

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
            console.error(`Error searching ${collection} with filters:`, error);
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
                console.error(`Error getting count for ${collection}:`, error);
                counts[collection] = 0;
            }
        });

        await Promise.allSettled(countPromises);
        return counts;
    }

    function getSearchHighlights(item, query, searchFields) {
        const highlights = {};
        const queryLower = query.toLowerCase();

        searchFields.forEach(field => {
            const value = item[field];
            if (value && typeof value === 'string') {
                const valueLower = value.toLowerCase();
                if (valueLower.includes(queryLower)) {
                    highlights[field] = value;
                }
            }
        });

        return highlights;
    }

    // Helper function to safely get nested field values (reuse from previous implementation)
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
            console.warn(`Error getting field ${fieldPath}:`, error);
            return undefined;
        }
    }

};