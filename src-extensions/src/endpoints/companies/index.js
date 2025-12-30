import {addFavoritesStatus, addRelationStatus, getCollectionCounts, getFavoriteStatus} from "../../helpers/index.js";

export default (router, { services, database, exceptions, getSchema }) => {
    const { ItemsService, AssetsService } = services;
    const { ServiceUnavailableException } = exceptions;

    // Helper function to apply subscription filters
    function applySubscriptionFilter(baseFilter, userAccess) {
        if (!userAccess.hasAccess) {
            // No access - return impossible filter
            return {
                ...baseFilter,
                id: { _null: true }, // Will return no results
            };
        }

        // Apply region and sector filters (AND logic between them, OR within each)
        const subscriptionFilter = {
            _and: [],
        };

        if (userAccess.regions.length > 0) {
            subscriptionFilter._and.push({
                regions: {
                    regions_id: {
                        id: { _in: userAccess.regions },
                    },
                },
            });
        }

        if (userAccess.sectors.length > 0) {
            subscriptionFilter._and.push({
                types: {
                    types_id: {
                        id: { _in: userAccess.sectors },
                    },
                },
            });
        }

        // Combine with existing filters
        if (baseFilter._and) {
            return {
                _and: [...baseFilter._and, ...subscriptionFilter._and],
            };
        } else if (Object.keys(baseFilter).length > 0) {
            return {
                _and: [baseFilter, ...subscriptionFilter._and],
            };
        } else {
            return subscriptionFilter._and.length > 0 ? subscriptionFilter : {};
        }
    }

    async function addFavoritesStatus(companies, userId, schema, accountability) {
        return addRelationStatus({
            items: companies,
            userId,
            schema,
            accountability,
            collection: 'favourites',
            itemField: 'item_id',
            extraFilter: { collection: 'companies' },
            flagName: 'is_favorited',
            idName: 'favorite_id',
        });
    }

    async function addNotificationsStatus(companies, userId, schema, accountability) {
        return addRelationStatus({
            items: companies,
            userId,
            schema,
            accountability,
            collection: 'user_newsletters',
            itemField: 'entity_id',
            extraFilter: { entity_type: 'companies' },
            flagName: 'has_notification',
        });
    }

    function groupCompanies(companies, groupBy) {
        const groups = new Map();

        companies.forEach(item => {
            let groupKeys = [];

            switch (groupBy) {
                case 'country':
                    groupKeys = item._originals.countries.map(c => ({
                        id: c.countries_id?.id,
                        name: c.countries_id?.name || 'Unknown Country',
                        data: c.countries_id
                    }));
                    break;
                case 'region':
                    groupKeys = item._originals.regions.map(r => ({
                        id: r.regions_id?.id,
                        name: r.regions_id?.name || 'Unknown Region',
                        data: r.regions_id
                    }));
                    break;
                case 'type':
                    groupKeys = item._originals.types.map(t => ({
                        id: t.types_id?.id,
                        name: t.types_id?.name || 'Unknown Type',
                        data: t.types_id
                    }));
                    break;
                case 'company':
                    groupKeys = item._originals.companies.map(c => ({
                        id: c.companies_id?.id,
                        name: c.companies_id?.name || 'Unknown Company',
                        data: c.companies_id
                    }));
                    break;
                default:
                    groupKeys = [{ id: 'all', name: 'All companies', data: null }];
            }

            // If no group keys found, add to "Unknown" group
            if (groupKeys.length === 0) {
                groupKeys = [{ id: 'unknown', name: `Unknown ${groupBy}`, data: null }];
            }

            // Add item to each group it belongs to
            groupKeys.forEach(groupKey => {
                if (!groups.has(groupKey.id)) {
                    groups.set(groupKey.id, {
                        id: groupKey.id,
                        name: groupKey.name,
                        data: groupKey.data,
                        companies: [],
                        count: 0,
                        totalValue: 0
                    });
                }

                const group = groups.get(groupKey.id);

                // Remove _originals before adding to group
                const cleanProject = { ...item };
                delete cleanProject._originals;

                group.companies.push(cleanProject);
                group.count++;

                // Calculate total value if value field exists
                if (item.contract_value_usd) {
                    group.totalValue += parseFloat(item.contract_value_usd) || 0;
                }
            });
        });

        // Convert Map to Array and sort by name
        return Array.from(groups.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }

    router.get('/', async (req, res, next) => {
        try {
            const { accountability } = req;
            const {
                sort = '-date_created',
                filter = {},
                search
            } = req.query;

            const groupBy = req.query.groupBy;
            const limit = parseInt(req.query.limit) || 50;
            const page = parseInt(req.query.page) || 1;
            const offset = (page - 1) * limit;

            const schema = await getSchema();
            const companiesService = new ItemsService('companies', {
                schema: schema,
                accountability: req.accountability,
            });

            const filterObj = req.query.filter || {};

            const { totalCount, filterCount } = await getCollectionCounts({
                service: companiesService,
                filter: filterObj,
            });

            // Build query
            let query = {
                limit: parseInt(limit),
                offset: parseInt(offset),
                sort: Array.isArray(sort) ? sort : [sort],
                fields: [
                    'id',
                    'name',
                    'slug',
                    'description',
                    'projects_completed',
                    "projects",
                    'logo.*',
                    'company_role',
                    'status',
                    'date_created',
                    'date_updated',
                    'favorites_count',

                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',

                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'regions.regions_id.slug',

                    'sectors.sectors_id.id',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.slug',

                    'types.types_id.id',
                    'types.types_id.name',
                ]
            };

            // Add filters if provided
            if (filter && Object.keys(filter).length > 0) {
                query.filter = filter;
            }

            // Add search if provided
            if (search) {
                query.search = search;
            }

            // Get companies
            const companies = await companiesService.readByQuery(query);

            const meta = {
                total_count: filterCount,
                filter_count: filterCount,
                limit: limit,
                page: page,
                page_count: Math.ceil(filterCount / limit)
            };

            const transformedCompanies = companies.map(item => {
                // Transform featured_image
                if (item.featured_image) {
                    if (typeof item.featured_image === 'object' && item.featured_image.id) {
                        item.featured_image.url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}`;
                        item.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.featured_image.id}?width=400&height=300&fit=cover`;
                    }
                }

                // Store original M2M data before flattening
                const originalCountries = item.countries ? [...item.countries] : [];
                const originalRegions = item.regions ? [...item.regions] : [];
                const originalTypes = item.types ? [...item.types] : [];
                const originalSectors = item.sectors ? [...item.sectors] : [];

                // Flatten M2M relations
                if (item.countries && Array.isArray(item.countries)) {
                    item.countries = item.countries.map(c => c.countries_id).filter(Boolean);
                }
                if (item.regions && Array.isArray(item.regions)) {
                    item.regions = item.regions.map(r => r.regions_id).filter(Boolean);
                }
                if (item.types && Array.isArray(item.types)) {
                    item.types = item.types.map(t => t.types_id).filter(Boolean);
                }
                if (item.sectors && Array.isArray(item.sectors)) {
                    item.sectors = item.sectors.map(t => t.sectors_id).filter(Boolean);
                }

                // Store originals for grouping
                if (groupBy) {
                    item._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        types: originalTypes,
                        sectors: originalSectors,
                    };
                }

                item.projects_completed = (item.projects && Array.isArray(item.projects)) ? item.projects.length : 0;

                return item;
            });

            // Handle grouping
            if (groupBy) {
                const grouped = groupCompanies(transformedCompanies, groupBy);
                const groupLimit = parseInt(req.query.limit) || 5;
                const groupPage = parseInt(req.query.page) || 1;
                const totalGroups = grouped.length;
                const start = (groupPage - 1) * groupLimit;
                const end = start + groupLimit;
                const paginatedGroups = grouped.slice(start, end);

                return res.json({
                    data: paginatedGroups,
                    meta: {
                        total_groups: totalGroups,
                        groupBy: groupBy,
                        page: groupPage,
                        limit: groupLimit,
                        page_count: Math.ceil(totalGroups / groupLimit)
                    }
                });
            }

            let finalItems = transformedCompanies;

            if (accountability?.user) {
                finalItems = await addFavoritesStatus(
                    finalItems,
                    accountability.user,
                    schema,
                    req.accountability,
                );

                finalItems = await addNotificationsStatus(
                    finalItems,
                    accountability.user,
                    schema,
                    req.accountability,
                );
            } else {
                finalItems = finalItems.map((project) => ({
                    ...project,
                    is_favorited: false,
                    favorite_id: null,
                    has_notification: false,
                }));
            }

            return res.json({
                data: finalItems,
                meta: meta
            });


        } catch (error) {
            console.error('Get companies with favorites error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch companies',
                details: error.message,
            });
        }
    });

    router.get('/public/recent', async (req, res, next) => {
        try {
            const companiesService = new ItemsService('companies', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent companies with minimal fields
            const result = await companiesService.readByQuery({
                fields: [
                    'id',
                    'name',
                    'slug',
                    'description',
                    'logo.id',
                    'logo.filename_disk',
                    'logo.title',
                ],
                limit: limit,
                sort: ['-date_created'], // Most recent first
                filter: {
                    status: { _eq: 'published' } // Only show published companies
                }
            });

            const companies = result.data || result;

            // Transform companies to include full asset URLs
            const transformedcompanies = companies.map(item => {
                if (item.logo && typeof item.logo === 'object' && item.logo.id) {
                    item.logo = {
                        id: item.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}?width=400&height=300&fit=cover`,
                        title: item.logo.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    logo: item.logo
                };
            });

            res.json({
                data: transformedcompanies,
                meta: {
                    total: transformedcompanies.length
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/public/trending', async (req, res, next) => {
        try {
            const companiesService = new ItemsService('companies', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent companies with minimal fields
            const result = await companiesService.readByQuery({
                fields: [
                    'id',
                    'name',
                    'slug',
                    'description',
                    'logo.id',
                    'logo.filename_disk',
                    'logo.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' },
                    is_trending: { _eq: true }
                }
            });

            const companies = result.data || result;

            // Transform companies to include full asset URLs
            const transformedcompanies = companies.map(item => {
                if (item.logo && typeof item.logo === 'object' && item.logo.id) {
                    item.logo = {
                        id: item.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}?width=400&height=300&fit=cover`,
                        title: item.logo.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    logo: item.logo
                };
            });

            res.json({
                data: transformedcompanies,
                meta: {
                    total: companies.length
                }
            });
        } catch (error) {
            console.log("trending error: ", error)
            next(error);
        }
    });
    
    router.get('/public/free', async (req, res, next) => {
        try {
            const companiesService = new ItemsService('companies', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50);

            // Fetch recent companies with minimal fields
            const result = await companiesService.readByQuery({
                fields: [
                    'id',
                    'name',
                    'slug',
                    'description',
                    'logo.id',
                    'logo.filename_disk',
                    'logo.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' },
                    is_trending: { _eq: true }
                }
            });

            const companies = result.data || result;

            // Transform companies to include full asset URLs
            const transformedcompanies = companies.map(item => {
                if (item.logo && typeof item.logo === 'object' && item.logo.id) {
                    item.logo = {
                        id: item.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${item.logo.id}?width=400&height=300&fit=cover`,
                        title: item.logo.title
                    };
                }

                return {
                    id: item.id,
                    title: item.title,
                    slug: item.slug,
                    summary: item.summary,
                    logo: item.logo
                };
            });

            res.json({
                data: transformedcompanies,
                meta: {
                    total: companies.length
                }
            });
        } catch (error) {
            console.log("trending error: ", error)
            next(error);
        }
    });

    router.get('/stats/filters', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { q } = req.query;

            // Validate filter parameter
            const validFilters = ['type', 'sector', 'region'];
            if (!q || !validFilters.includes(q)) {
                return res.status(400).json({
                    error: 'Invalid filter parameter. Must be one of: type, sector, region'
                });
            }

            const itemService = new ItemsService('companies', {
                schema: schema,
                accountability: req.accountability
            });

            // Get all projects with the relevant relations
            const fieldMap = {
                type: 'types.types_id.*',
                sector: 'sectors.sectors_id.*',
                region: 'regions.regions_id.*'
            };

            const items = await itemService.readByQuery({
                fields: ['id', fieldMap[q]],
                limit: -1 // Get all items
            });

            // Get the relation key
            const relationKey = q === 'type' ? 'types' :
                q === 'sector' ? 'sectors' : 'regions';
            const idKey = `${q === 'type' ? 'types' :
                q === 'sector' ? 'sectors' : 'regions'}_id`;

            // Count occurrences
            const statsMap = new Map();
            let totalItems = 0;

            items.forEach(data => {
                if (data[relationKey] && Array.isArray(data[relationKey])) {
                    data[relationKey].forEach(rel => {
                        if (rel[idKey]) {
                            const item = rel[idKey];
                            const key = item.id;

                            if (!statsMap.has(key)) {
                                statsMap.set(key, {
                                    id: item.id,
                                    name: item.name,
                                    slug: item.slug || null,
                                    count: 0
                                });
                            }

                            statsMap.get(key).count++;
                            totalItems++;
                        }
                    });
                }
            });

            // Convert to array and calculate percentages
            const stats = Array.from(statsMap.values())
                .map(stat => ({
                    ...stat,
                    percentage: totalItems > 0
                        ? Math.round((stat.count / totalItems) * 100 * 10) / 10
                        : 0
                }))
                .sort((a, b) => b.count - a.count); // Sort by count descending

            return res.json({
                data: {
                    filter: q,
                    total: items.length,
                    total_relations: totalItems,
                    stats: stats
                }
            });

        } catch (error) {
            console.error('Companies stats error:', error);
            next(error);
        }
    });

    router.get('/:id', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;
            const itemId = req.params.id;

            const companiesService = new ItemsService('companies', {
                schema: schema,
                accountability: accountability
            });

            // Fetch ALL data for single item endpoint
            const item = await companiesService.readOne(req.params.id, {
                fields: [
                    '*',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'regions.regions_id.slug',
                    'sectors.sectors_id.id',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.slug',

                    'types.types_id.id',
                    'types.types_id.name',

                    'projects.project_id.id',
                    'projects.project_id.title',
                    'projects.project_id.current_status.name',
                    'projects.project_id.estimated_project_value_usd',
                    'projects.project_id.contract_value_usd',
                    'projects.project_id.value_range',
                    'projects.project_id.countries',
                    'projects.project_id.countries.countries_id.id',
                    'projects.project_id.countries.countries_id.name',
                    'projects.project_id.countries.countries_id.slug',
                    'projects.role_id.id',
                    'projects.role_id.name',
                    'projects.role_id.slug',

                    'contacts.*',

                    'logo.*'
                ]
            });

            // Transform logo
            if (item.logo && typeof item.logo === 'object' && item.logo.id) {
                item.logo.url = `${process.env.PUBLIC_URL}/assets/${item.logo.id}`;
                item.logo.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${item.logo.id}?width=400&height=300&fit=cover`;
            }

            // Flatten M2M relations
            if (item.countries && Array.isArray(item.countries)) {
                item.countries = item.countries.map(c => c.countries_id).filter(Boolean);
            }
            if (item.regions && Array.isArray(item.regions)) {
                item.regions = item.regions.map(r => r.regions_id).filter(Boolean);
            }
            if (item.types && Array.isArray(item.types)) {
                item.types = item.types.map(t => t.types_id).filter(Boolean);
            }

            if (item.sectors && Array.isArray(item.sectors)) {
                item.sectors = item.sectors.map(t => t.sectors_id).filter(Boolean);
            }

            if (item.projects && Array.isArray(item.projects)) {
                item.projects = item.projects
                    .filter(pc => pc.project_id)
                    .map(pc => ({
                        id: pc.id,
                        project: {
                            id: pc.project_id.id,
                            name: pc.project_id.title || null,
                            current_status: pc.project_id.current_status?.name || null,
                            estimated_project_value_usd: pc.project_id?.estimated_project_value_usd || null,
                            value_range: pc.project_id?.value_range || null,
                            contract_value_usd: pc.project_id?.contract_value_usd || null,
                            countries: pc.project_id?.countries
                        },
                        role: pc.role_id ? {
                            id: pc.role_id.id,
                            name: pc.role_id.name || null,
                            slug: pc.role_id.slug || null,
                        } : null,
                    }));
            } else {
                item.projects = [];
            }

            const { is_favorited, favorite_id } = accountability?.user
                ? await getFavoriteStatus({
                    itemId,
                    collection: 'companies',
                    userId: accountability.user,
                    schema,
                    accountability,
                    ItemsService
                })
                : { is_favorited: false, favorite_id: null };

            const itemWithFavorite = {
                ...item,
                is_favorited,
                favorite_id
            };

            res.json({
                data: itemWithFavorite
            });
        } catch (error) {
            next(error);
        }
    });
};