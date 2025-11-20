export default (router, { services, exceptions }) => {
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

    async function addCompaniesFavoritesStatus(companies, userId, schema, accountability) {
        if (companies.length === 0) return companies;

        const favoritesService = new ItemsService('favourites', {
            schema: schema,
            accountability: accountability,
        });

        // Get company IDs
        const companyIds = companies.map(company => company.id);

        // Get user's favorites for these companies
        const userFavorites = await favoritesService.readByQuery({
            filter: {
                _and: [
                    { user_created: { _eq: userId } },
                    { collection: { _eq: 'companies' } },
                    { item_id: { _in: companyIds } },
                ],
            },
            fields: ['id', 'item_id'],
            limit: -1
        });

        // Create a map for quick lookup
        const favoritesMap = new Map();
        userFavorites.forEach(fav => {
            favoritesMap.set(fav.item_id, fav.id);
        });

        // Add is_favorited and favorite_id to each company
        return companies.map(company => ({
            ...company,
            is_favorited: favoritesMap.has(company.id),
            favorite_id: favoritesMap.get(company.id) || null
        }));
    }

    function groupCompanies(companies, groupBy) {
        const groups = new Map();

        companies.forEach(project => {
            let groupKeys = [];

            switch (groupBy) {
                case 'country':
                    groupKeys = project._originals.countries.map(c => ({
                        id: c.countries_id?.id,
                        name: c.countries_id?.name || 'Unknown Country',
                        data: c.countries_id
                    }));
                    break;
                case 'region':
                    groupKeys = project._originals.regions.map(r => ({
                        id: r.regions_id?.id,
                        name: r.regions_id?.name || 'Unknown Region',
                        data: r.regions_id
                    }));
                    break;
                case 'type':
                    groupKeys = project._originals.types.map(t => ({
                        id: t.types_id?.id,
                        name: t.types_id?.name || 'Unknown Type',
                        data: t.types_id
                    }));
                    break;
                case 'company':
                    groupKeys = project._originals.companies.map(c => ({
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

            // Add project to each group it belongs to
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
                const cleanProject = { ...project };
                delete cleanProject._originals;

                group.companies.push(cleanProject);
                group.count++;

                // Calculate total value if value field exists
                if (project.contract_value_usd) {
                    group.totalValue += parseFloat(project.contract_value_usd) || 0;
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
                limit = 50,
                offset = 0,
                sort = '-date_created',
                filter = {},
                search
            } = req.query;

            const schema = await getSchema();
            const companiesService = new ItemsService('companies', {
                schema: schema,
                accountability: req.accountability,
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
                    'logo.*',
                    'company_role',
                    'status',
                    'date_created',
                    'date_updated',
                    'favorites_count'
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

            // If user is authenticated, check which companies are favorited
            if (accountability?.user) {
                const companiesWithFavorites = await addCompaniesFavoritesStatus(
                    companies,
                    accountability.user,
                    schema,
                    req.accountability
                );

                return res.json({
                    success: true,
                    companies: companiesWithFavorites,
                    total: companies.length,
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    authenticated: true
                });
            }

            // For non-authenticated users
            const companiesWithDefaultFavorites = companies.map(company => ({
                ...company,
                is_favorited: false,
                favorite_id: null
            }));

            return res.json({
                success: true,
                companies: companiesWithDefaultFavorites,
                total: companies.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                authenticated: false
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
            const transformedcompanies = companies.map(project => {
                if (project.logo && typeof project.logo === 'object' && project.logo.id) {
                    project.logo = {
                        id: project.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}?width=400&height=300&fit=cover`,
                        title: project.logo.title
                    };
                }

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    logo: project.logo
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
            const transformedcompanies = companies.map(project => {
                if (project.logo && typeof project.logo === 'object' && project.logo.id) {
                    project.logo = {
                        id: project.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}?width=400&height=300&fit=cover`,
                        title: project.logo.title
                    };
                }

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    logo: project.logo
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
            const transformedcompanies = companies.map(project => {
                if (project.logo && typeof project.logo === 'object' && project.logo.id) {
                    project.logo = {
                        id: project.logo.id,
                        url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.logo.id}?width=400&height=300&fit=cover`,
                        title: project.logo.title
                    };
                }

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    logo: project.logo
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

    router.get('/:id', async (req, res, next) => {
        try {
            const companiesService = new ItemsService('companies', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Fetch ALL data for single project endpoint
            const project = await companiesService.readOne(req.params.id, {
                fields: [
                    '*',
                    'countries.countries_id.*',
                    'regions.regions_id.*',
                    'types.types_id.*',
                    'funding.funding_id.*',
                    'client_owner.companies_id.*',
                    'developer.companies_id.*',
                    'companies.companies_id.*',
                    'authority.companies_id.id',
                    'authority.companies_id.name',
                    'architect.companies_id.id',
                    'architect.companies_id.name',
                    'design_consultant.companies_id.id',
                    'design_consultant.companies_id.name',
                    'project_manager.companies_id.id',
                    'project_manager.companies_id.name',
                    'civil_engineer.companies_id.id',
                    'civil_engineer.companies_id.name',
                    'structural_engineer.companies_id.id',
                    'structural_engineer.companies_id.name',
                    'mep_engineer.companies_id.id',
                    'mep_engineer.companies_id.name',
                    'electrical_engineer.companies_id.id',
                    'electrical_engineer.companies_id.name',
                    'geotechnical_engineer.companies_id.id',
                    'geotechnical_engineer.companies_id.name',
                    'cost_consultants.companies_id.id',
                    'cost_consultants.companies_id.name',
                    'quantity_surveyor.companies_id.id',
                    'quantity_surveyor.companies_id.name',
                    'landscape_architect.companies_id.id',
                    'landscape_architect.companies_id.name',
                    'legal_adviser.companies_id.id',
                    'legal_adviser.companies_id.name',
                    'transaction_advisor.companies_id.id',
                    'transaction_advisor.companies_id.name',
                    'study_consultant.companies_id.id',
                    'study_consultant.companies_id.name',
                    // 'funding.companies_id.id',
                    // 'funding.companies_id.name',
                    'main_contractor.companies_id.id',
                    'main_contractor.companies_id.name',
                    'main_contract_bidder.companies_id.id',
                    'main_contract_bidder.companies_id.name',
                    'main_contract_prequalified.companies_id.id',
                    'main_contract_prequalified.companies_id.name',
                    'mep_subcontractor.companies_id.id',
                    'mep_subcontractor.companies_id.name',
                    'piling_subcontractor.companies_id.id',
                    'piling_subcontractor.companies_id.name',
                    'facade_subcontractor.companies_id.id',
                    'facade_subcontractor.companies_id.name',
                    'lift_subcontractor.companies_id.id',
                    'lift_subcontractor.companies_id.name',
                    'other_subcontractor.companies_id.id',
                    'other_subcontractor.companies_id.name',
                    'operator.companies_id.id',
                    'operator.companies_id.name',
                    'feed.companies_id.id',
                    'feed.companies_id.name',
                    'logo.*'
                ]
            });

            const flattenRelationships = (relationArray, idField = 'id') => {
                if (!relationArray || !Array.isArray(relationArray)) return [];

                return relationArray
                    .map(item => {
                        // Extract the related object (handles both direct and nested structures)
                        const relatedObj = item[`${idField}_id`] || item;
                        if (!relatedObj || !relatedObj.id) return null;

                        return {
                            id: relatedObj.id,
                            name: relatedObj.name || 'Unnamed'
                        };
                    })
                    .filter(Boolean);
            };

            // Transform logo
            if (project.logo && typeof project.logo === 'object' && project.logo.id) {
                project.logo.url = `${process.env.PUBLIC_URL}/assets/${project.logo.id}`;
                project.logo.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.logo.id}?width=400&height=300&fit=cover`;
            }

            // Flatten M2M relations
            if (project.countries && Array.isArray(project.countries)) {
                project.countries = project.countries.map(c => c.countries_id).filter(Boolean);
            }
            if (project.regions && Array.isArray(project.regions)) {
                project.regions = project.regions.map(r => r.regions_id).filter(Boolean);
            }
            if (project.types && Array.isArray(project.types)) {
                project.types = project.types.map(t => t.types_id).filter(Boolean);
            }
            if (project.funding && Array.isArray(project.funding)) {
                project.funding = project.funding.map(f => f.funding_id).filter(Boolean);
            }
            if (project.companies && Array.isArray(project.companies)) {
                project.companies = project.companies.map(c => c.companies_id).filter(Boolean);
            }
            if (project.client_owner && Array.isArray(project.client_owner)) {
                project.client_owner = project.client_owner.map(c => c.companies_id).filter(Boolean);
            }
            if (project.developer && Array.isArray(project.developer)) {
                project.developer = project.developer.map(d => d.companies_id).filter(Boolean);
            }

            project.developer = flattenRelationships(project.developer, 'companies');
            project.authority = flattenRelationships(project.authority, 'companies');
            project.architect = flattenRelationships(project.architect, 'companies');
            project.design_consultant = flattenRelationships(project.design_consultant, 'companies');
            project.project_manager = flattenRelationships(project.project_manager, 'companies');
            project.civil_engineer = flattenRelationships(project.civil_engineer, 'companies');
            project.structural_engineer = flattenRelationships(project.structural_engineer, 'companies');
            project.mep_engineer = flattenRelationships(project.mep_engineer, 'companies');
            project.electrical_engineer = flattenRelationships(project.electrical_engineer, 'companies');
            project.geotechnical_engineer = flattenRelationships(project.geotechnical_engineer, 'companies');
            project.cost_consultants = flattenRelationships(project.cost_consultants, 'companies');
            project.quantity_surveyor = flattenRelationships(project.quantity_surveyor, 'companies');
            project.landscape_architect = flattenRelationships(project.landscape_architect, 'companies');
            project.legal_adviser = flattenRelationships(project.legal_adviser, 'companies');
            project.transaction_advisor = flattenRelationships(project.transaction_advisor, 'companies');
            project.study_consultant = flattenRelationships(project.study_consultant, 'companies');
            project.funding = flattenRelationships(project.funding, 'companies');
            project.main_contractor = flattenRelationships(project.main_contractor, 'companies');
            project.main_contract_bidder = flattenRelationships(project.main_contract_bidder, 'companies');
            project.main_contract_prequalified = flattenRelationships(project.main_contract_prequalified, 'companies');
            project.mep_subcontractor = flattenRelationships(project.mep_subcontractor, 'companies');
            project.piling_subcontractor = flattenRelationships(project.piling_subcontractor, 'companies');
            project.facade_subcontractor = flattenRelationships(project.facade_subcontractor, 'companies');
            project.lift_subcontractor = flattenRelationships(project.lift_subcontractor, 'companies');
            project.other_subcontractor = flattenRelationships(project.other_subcontractor, 'companies');
            project.operator = flattenRelationships(project.operator, 'companies');
            project.feed = flattenRelationships(project.feed, 'companies');

            let is_favorited = false;
            let favorite_id = null;
            const favoritesService = new ItemsService('favourites', {
                schema: schema,
                accountability: req.accountability,
            });

            const existingFavorite = await favoritesService.readByQuery({
                filter: {
                    _and: [
                        { user_created: { _eq: accountability.user } },
                        { collection: { _eq: 'companies' } },
                        { item_id: { _eq: id } },
                    ],
                },
                limit: 1,
            });

            if (existingFavorite.length > 0) {
                is_favorited = true;
                favorite_id = existingFavorite[0].id;
            }

            const projectWithFavorite = {
                ...project,
                is_favorited,
                favorite_id
            };

            res.json({
                data: projectWithFavorite
            });
        } catch (error) {
            next(error);
        }
    });
};