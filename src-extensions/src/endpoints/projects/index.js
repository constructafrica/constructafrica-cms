export default (router, { services, exceptions, getSchema}) => {
    const { ItemsService, AssetsService } = services;
    const { ServiceUnavailableException } = exceptions;

    async function getUserAccessibleFilters(accountability) {
        if (!accountability?.user) {
            return { regions: [], sectors: [], hasAccess: false };
        }

        const user = await database('directus_users')
            .where('id', accountability.user)
            .first('subscription_type', 'subscription_status', 'active_subscription');

        if (!user || user.subscription_status !== 'active' || user.subscription_type !== 'projects') {
            return { regions: [], sectors: [], hasAccess: false };
        }

        const regions = await database('user_subscription_regions')
            .where('user_subscriptions_id', user.active_subscription)
            .pluck('regions_id');

        const sectors = await database('user_subscription_sectors')
            .where('user_subscriptions_id', user.active_subscription)
            .pluck('types_id');

        return {
            regions,
            sectors,
            hasAccess: true,
            subscriptionType: user.subscription_type
        };
    }

    async function addFavoritesStatus(projects, userId, schema, accountability) {
        if (!projects || projects.length === 0) return projects;

        try {
            const favoritesService = new ItemsService('favourites', {
                schema: schema,
                accountability: accountability,
            });

            // Get project IDs
            const projectIds = projects.map(project => project.id);

            // Get user's favorites for these projects
            const userFavorites = await favoritesService.readByQuery({
                filter: {
                    _and: [
                        { user_created: { _eq: userId } },
                        { collection: { _eq: 'projects' } },
                        { item_id: { _in: projectIds } },
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

            // Add is_favorited and favorite_id to each project
            return projects.map(project => ({
                ...project,
                is_favorited: favoritesMap.has(project.id),
                favorite_id: favoritesMap.get(project.id) || null
            }));
        } catch (error) {
            console.error('Error in addFavoritesStatus:', error);
            throw error; // Re-throw to be handled by the caller
        }
    }

    function groupProjects(projects, groupBy) {
        const groups = new Map();

        projects.forEach(project => {
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
                case 'sector':
                    groupKeys = project._originals.sectors.map(r => ({
                        id: r.sectors_id?.id,
                        name: r.sectors_id?.name || 'Unknown Region',
                        data: r.sectors_id
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
                    groupKeys = [{ id: 'all', name: 'All Projects', data: null }];
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
                        projects: [],
                        count: 0,
                        totalValue: 0
                    });
                }

                const group = groups.get(groupKey.id);

                // Remove _originals before adding to group
                const cleanProject = { ...project };
                delete cleanProject._originals;

                group.projects.push(cleanProject);
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

    function flattenRelationships (relationArray, idField = 'id') {
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

    router.get('/old', async (req, res, next) => {
        try {
            const { accountability } = req; // Get accountability from req
            const schema = await getSchema();
            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: req.accountability
            });

            // Check if grouping is requested
            const groupBy = req.query.groupBy; // e.g., 'country', 'region', 'type'

            // Pagination params
            const limit = parseInt(req.query.limit) || 25;
            const page = parseInt(req.query.page) || 1;

            // Fetch projects with only id and name for M2M relations
            const result = await projectsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'contract_value_usd',
                    'summary',
                    'description',
                    'estimated_project_value_usd',
                    'value_range',
                    'construction_start_date',
                    'location',
                    'current_stage',
                    'email',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'types.types_id.id',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',
                    'types.types_id.name',
                    'subsectors.subsectors_id.name',
                    'subsectors.subsectors_id.id',
                    'countries.countries_id.slug',
                    'sectors.sectors_id.slug',
                    'regions.regions_id.slug',
                    'featured_image',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                    'featured_image.filesize',
                ],
                limit: groupBy ? -1 : limit,
                offset: groupBy ? 0 : (page - 1) * limit,
                filter: req.query.filter || {},
                meta: ['total_count', 'filter_count'],
            });

            const projects = result.data || result;
            const meta = result.meta || {};

            console.log('Directus meta:', meta);

            // Transform the response to include full asset URLs and flatten M2M relations
            const transformedProjects = projects.map(project => {
                // Transform featured_image to include full URL
                if (project.featured_image) {
                    if (typeof project.featured_image === 'object' && project.featured_image.id) {
                        project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                        project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
                    }
                }

                // Store original M2M data before flattening (for grouping)
                const originalCountries = project.countries ? [...project.countries] : [];
                const originalRegions = project.regions ? [...project.regions] : [];
                const originalTypes = project.types ? [...project.types] : [];
                const originalSectors = project.sectors ? [...project.sectors] : [];

                // Flatten M2M relations to return just the related objects (id and name only)
                if (project.countries && Array.isArray(project.countries)) {
                    project.countries = project.countries.map(c => c.countries_id).filter(Boolean);
                }
                if (project.regions && Array.isArray(project.regions)) {
                    project.regions = project.regions.map(r => r.regions_id).filter(Boolean);
                }
                if (project.types && Array.isArray(project.types)) {
                    project.types = project.types.map(t => t.types_id).filter(Boolean);
                }
                if (project.sectors && Array.isArray(project.sectors)) {
                    project.sectors = project.sectors.map(t => t.sectors_id).filter(Boolean);
                }

                // Store originals for grouping
                if (groupBy) {
                    project._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        types: originalTypes,
                        sectors: originalSectors,
                    };
                }

                return project;
            });

            // If grouping is requested, group the projects
            if (groupBy) {
                const grouped = groupProjects(transformedProjects, groupBy);

                // Pagination for groups
                const groupLimit = parseInt(req.query.limit) || 5; // Default 5 groups per page
                const groupPage = parseInt(req.query.page) || 1;

                const totalGroups = grouped.length;
                const start = (groupPage - 1) * groupLimit;
                const end = start + groupLimit;

                const paginatedGroups = grouped.slice(start, end);

                res.json({
                    data: paginatedGroups,
                    meta: {
                        total_groups: totalGroups,
                        groupBy: groupBy,
                        page: groupPage,
                        limit: groupLimit,
                        page_count: Math.ceil(totalGroups / groupLimit)
                    }
                });
            } else {
                // Return paginated response - only add favorites if user is authenticated
                let finalProjects = transformedProjects;

                if (accountability?.user) {
                    // User is authenticated, add favorites status
                    finalProjects = await addFavoritesStatus(
                        transformedProjects,
                        accountability.user,
                        schema,
                        req.accountability
                    );
                } else {
                    // User is not authenticated, add default favorite status
                    finalProjects = transformedProjects.map(project => ({
                        ...project,
                        is_favorited: false,
                        favorite_id: null
                    }));
                }

                // res.json({
                //     data: finalProjects,
                //     meta: {
                //         total_count: meta.total_count || meta.filter_count || transformedProjects.length,
                //         filter_count: meta.filter_count || transformedProjects.length,
                //         page: page,
                //         limit: limit,
                //         page_count: Math.ceil((meta.filter_count || transformedProjects.length) / limit),
                //         authenticated: !!accountability?.user
                //     }
                // });
                res.json({
                    data: finalProjects,
                    meta: {
                        total_count: meta.total_count,
                        filter_count: meta.filter_count,
                        page,
                        limit,
                        page_count: Math.ceil(meta.total_count / limit),
                        authenticated: !!accountability?.user
                    }
                });
            }
        } catch (error) {
            console.log("projects error: ", error)
            next(error);
        }
    });

    router.get('/', async (req, res, next) => {
        try {
            const { accountability } = req; // Get accountability from req
            const schema = await getSchema();
            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: req.accountability
            });

            // Check if grouping is requested
            const groupBy = req.query.groupBy; // e.g., 'country', 'region', 'type'

            // Pagination params
            const limit = parseInt(req.query.limit) || 25;
            const page = parseInt(req.query.page) || 1;

            // Fetch projects with companies relationship
            const result = await projectsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'contract_value_usd',
                    'summary',
                    'description',
                    'estimated_project_value_usd',
                    'value_range',
                    'construction_start_date',
                    'location',
                    'current_stage',
                    'current_status.id',
                    'current_status.name',
                    'current_status.slug',
                    'email',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'regions.regions_id.slug',
                    'types.types_id.id',
                    'types.types_id.name',
                    'sectors.sectors_id.id',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.slug',
                    'subsectors.subsectors_id.id',
                    'subsectors.subsectors_id.name',
                    'featured_image',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                    'featured_image.filesize',
                    // Companies relationship through junction table
                    // 'companies.id',
                    // 'companies.company_id.id',
                    // 'companies.company_id.name',
                    // 'companies.company_id.email',
                    // 'companies.company_id.phone',
                    // 'companies.role_id.id',
                    // 'companies.role_id.name',
                    // 'companies.role_id.slug',
                    //
                    // //contacts
                    // 'contacts.company_contacts_id.id',
                    // 'contacts.company_contacts_id.name',
                    // 'contacts.company_contacts_id.email',
                    // 'contacts.company_contacts_id.phone',
                ],

                limit: groupBy ? -1 : limit,
                sort: ['-date_created'],
                offset: groupBy ? 0 : (page - 1) * limit,
                filter: req.query.filter || {},
                meta: ['total_count', 'filter_count'],
            });

            const projects = result.data || result;
            // const meta = result.meta || {};
            const totalCount = await projectsService.readByQuery({
                // Reuse the same filter to get the accurate filtered count
                filter: req.query.filter || {},
                meta: 'total_count',
                limit: 0, // Request no data, just the count
            });

            const meta = {
                total_count: totalCount || projects.length, // Fallback to current page length if count fails
                filter_count: totalCount || projects.length,
                limit: limit,
                page: page,
            };

            console.log('Directus meta:', totalCount);

            // Transform the response to include full asset URLs and flatten M2M relations
            const transformedProjects = projects.map(project => {
                // Transform featured_image to include full URL
                if (project.featured_image) {
                    if (typeof project.featured_image === 'object' && project.featured_image.id) {
                        project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                        project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
                    }
                }

                // Store original M2M data before flattening (for grouping)
                const originalCountries = project.countries ? [...project.countries] : [];
                const originalRegions = project.regions ? [...project.regions] : [];
                const originalTypes = project.types ? [...project.types] : [];
                const originalSectors = project.sectors ? [...project.sectors] : [];

                // Flatten M2M relations to return just the related objects (id and name only)
                if (project.countries && Array.isArray(project.countries)) {
                    project.countries = project.countries.map(c => c.countries_id).filter(Boolean);
                }
                if (project.regions && Array.isArray(project.regions)) {
                    project.regions = project.regions.map(r => r.regions_id).filter(Boolean);
                }
                if (project.types && Array.isArray(project.types)) {
                    project.types = project.types.map(t => t.types_id).filter(Boolean);
                }
                if (project.sectors && Array.isArray(project.sectors)) {
                    project.sectors = project.sectors.map(t => t.sectors_id).filter(Boolean);
                }

                // Transform companies relationship
                // if (project.companies && Array.isArray(project.companies)) {
                //     project.companies = project.companies
                //         .filter(pc => pc.company_id) // Only include items with valid company
                //         .map(pc => ({
                //             id: pc.id,
                //             company: {
                //                 id: pc.company_id.id,
                //                 name: pc.company_id.name,
                //                 email: pc.company_id.email || null,
                //                 phone: pc.company_id.phone || null,
                //             },
                //             role: pc.role_id ? {
                //                 id: pc.role_id.id,
                //                 name: pc.role_id.name,
                //                 slug: pc.role_id.slug || null,
                //             } : null,
                //         }));
                // } else {
                //     project.companies = [];
                // }

                // if (project.contacts && Array.isArray(project.contacts)) {
                //     project.contacts = project.contacts
                //         .filter(pc => pc.company_contacts_id) // Only include items with valid company
                //         .map(pc => ({
                //             id: pc.company_contacts_id.id,
                //             name: pc.company_contacts_id.name,
                //             email: pc.company_contacts_id.email || null,
                //             phone: pc.company_contacts_id.phone || null,
                //             role: pc.company_contacts_id.role || null,
                //             company: pc.company_contacts_id.company_id.name || null,
                //         }));
                // } else {
                //     project.contacts = [];
                // }

                // Store originals for grouping
                if (groupBy) {
                    project._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        types: originalTypes,
                        sectors: originalSectors,
                    };
                }

                return project;
            });

            // If grouping is requested, group the projects
            if (groupBy) {
                const grouped = groupProjects(transformedProjects, groupBy);

                // Pagination for groups
                const groupLimit = parseInt(req.query.limit) || 5; // Default 5 groups per page
                const groupPage = parseInt(req.query.page) || 1;

                const totalGroups = grouped.length;
                const start = (groupPage - 1) * groupLimit;
                const end = start + groupLimit;

                const paginatedGroups = grouped.slice(start, end);

                res.json({
                    data: paginatedGroups,
                    meta: {
                        total_groups: totalGroups,
                        groupBy: groupBy,
                        page: groupPage,
                        limit: groupLimit,
                        page_count: Math.ceil(totalGroups / groupLimit)
                    }
                });
            } else {
                // Return paginated response - only add favorites if user is authenticated
                let finalProjects = transformedProjects;

                if (accountability?.user) {
                    // User is authenticated, add favorites status
                    finalProjects = await addFavoritesStatus(
                        transformedProjects,
                        accountability.user,
                        schema,
                        req.accountability
                    );
                } else {
                    // User is not authenticated, add default favorite status
                    finalProjects = transformedProjects.map(project => ({
                        ...project,
                        is_favorited: false,
                        favorite_id: null
                    }));
                }

                // res.json({
                //     data: finalProjects,
                //     meta: {
                //         total_count: meta.total_count,
                //         filter_count: meta.filter_count,
                //         page,
                //         limit,
                //         page_count: Math.ceil(meta.total_count / limit),
                //         authenticated: !!accountability?.user
                //     }
                // });

                const totalCount = meta?.total_count ?? 0;

                res.json({
                    data: finalProjects,
                    meta: meta
                });
            }
        } catch (error) {
            console.log("projects error: ", error)
            next(error);
        }
    });

    router.get('/public/recent', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent projects with minimal fields
            const result = await projectsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'description',
                    'current_stage',
                    'contract_value_usd',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',
                    'sectors.sectors_id.slug',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                ],
                limit: limit,
                sort: ['-date_created'], // Most recent first
                filter: {
                    status: { _eq: 'published' } // Only show published projects
                }
            });

            const projects = result.data || result;

            // Transform projects to include full asset URLs
            const transformedProjects = projects.map(project => {
                if (project.featured_image && typeof project.featured_image === 'object' && project.featured_image.id) {
                    project.featured_image = {
                        id: project.featured_image.id,
                        url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`,
                        title: project.featured_image.title
                    };
                }

                const sectors = flattenRelationships(project.sectors, 'sectors');
                const countries = flattenRelationships(project.countries, 'countries');
                const regions = flattenRelationships(project.regions, 'regions');

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    description: project.description,
                    current_stage: project.current_stage,
                    contract_value_usd: project.contract_value_usd,
                    location: project.location,
                    date_created: project.date_created,
                    featured_image: project.featured_image,
                    sectors: sectors,
                    countries: countries,
                    regions: regions,
                };
            });

            res.json({
                data: transformedProjects,
                meta: {
                    total: transformedProjects.length
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/public/trending', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: null
            });

            // Get limit from query or default to 10
            const limit = Math.min(parseInt(req.query.limit) || 10, 50); // Max 50

            // Fetch recent projects with minimal fields
            const result = await projectsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'summary',
                    'description',
                    'current_stage',
                    'contract_value_usd',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',
                    'sectors.sectors_id.slug',
                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                ],
                limit: limit,
                sort: ['-date_created'],
                filter: {
                    status: { _eq: 'published' },
                    is_trending: { _eq: true }
                }
            });

            const projects = result.data || result;

            // Transform projects to include full asset URLs
            const transformedProjects = projects.map(project => {
                if (project.featured_image && typeof project.featured_image === 'object' && project.featured_image.id) {
                    project.featured_image = {
                        id: project.featured_image.id,
                        url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`,
                        thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`,
                        title: project.featured_image.title
                    };
                }

                const sectors = flattenRelationships(project.sectors, 'sectors');
                const countries = flattenRelationships(project.countries, 'countries');
                const regions = flattenRelationships(project.regions, 'regions');

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    description: project.description,
                    current_stage: project.current_stage,
                    contract_value_usd: project.contract_value_usd,
                    location: project.location,
                    date_created: project.date_created,
                    featured_image: project.featured_image,
                    sectors: sectors,
                    countries: countries,
                    regions: regions,
                };
            });

            res.json({
                data: transformedProjects,
                meta: {
                    total: projects.length
                }
            });
        } catch (error) {
            console.log("trending error: ", error)
            next(error);
        }
    });

    router.get('/:id', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;
            const projectId = req.params.id; // Get the ID from params

            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: req.accountability
            });

            // Fetch ALL data for single project endpoint
            const project = await projectsService.readOne(projectId, {
                fields: [
                    '*',

                    'countries.countries_id.id',
                    'countries.countries_id.name',
                    'countries.countries_id.slug',
                    'sectors.sectors_id.slug',
                    'regions.regions_id.slug',
                    'regions.regions_id.id',
                    'regions.regions_id.name',
                    'types.types_id.id',
                    'sectors.sectors_id.name',
                    'sectors.sectors_id.id',
                    'types.types_id.name',

                    // Companies relationship through junction table
                    'companies.id',
                    'companies.company_id.id',
                    'companies.company_id.name',
                    'companies.company_id.email',
                    'companies.company_id.phone',
                    'companies.role_id.id',
                    'companies.role_id.name',
                    'companies.role_id.slug',

                    //contacts
                    'contacts.company_contacts_id.id',
                    'contacts.company_contacts_id.name',
                    'contacts.company_contacts_id.email',
                    'contacts.company_contacts_id.phone',

                    'featured_image.*',
                    'news.*'
                ]
            });

            // Transform featured_image
            if (project.featured_image && typeof project.featured_image === 'object' && project.featured_image.id) {
                project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
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
            if (project.sectors && Array.isArray(project.sectors)) {
                project.sectors = project.sectors.map(t => t.sectors_id).filter(Boolean);
            }

            // Transform companies relationship
            if (project.companies && Array.isArray(project.companies)) {
                project.companies = project.companies
                    .filter(pc => pc.company_id) // Only include items with valid company
                    .map(pc => ({
                        id: pc.id,
                        company: {
                            id: pc.company_id.id,
                            name: pc.company_id.name || null,
                            email: pc.company_id.email || null,
                            phone: pc.company_id.phone || null,
                        },
                        role: pc.role_id ? {
                            id: pc.role_id.id,
                            name: pc.role_id.name,
                            slug: pc.role_id.slug || null,
                        } : null,
                    }));
            } else {
                project.companies = [];
            }

            if (project.contacts && Array.isArray(project.contacts)) {
                project.contacts = project.contacts
                    .filter(pc => pc.company_contacts_id) // Only include items with valid company
                    .map(pc => ({
                        id: pc.company_contacts_id.id,
                        name: pc.company_contacts_id.name || null,
                        email: pc.company_contacts_id.email || null,
                        phone: pc.company_contacts_id.phone || null,
                        role: pc.company_contacts_id.role || null,
                        // company: pc.company_contacts_id.company_id.name || null,
                    }));
            } else {
                project.contacts = [];
            }



            // Handle favorites status
            let is_favorited = false;
            let favorite_id = null;

            // Only check favorites if user is authenticated
            if (accountability?.user) {
                try {
                    const favoritesService = new ItemsService('favourites', {
                        schema: schema,
                        accountability: accountability,
                    });

                    const existingFavorite = await favoritesService.readByQuery({
                        filter: {
                            _and: [
                                { user_created: { _eq: accountability.user } },
                                { collection: { _eq: 'projects' } },
                                { item_id: { _eq: projectId } }, // Use projectId variable
                            ],
                        },
                        limit: 1,
                    });

                    if (existingFavorite.length > 0) {
                        is_favorited = true;
                        favorite_id = existingFavorite[0].id;
                    }
                } catch (favoritesError) {
                    console.warn('Failed to fetch favorite status:', favoritesError.message);
                    // Continue without favorite status - don't break the entire request
                }
            }

            const projectWithFavorite = {
                ...project,
                is_favorited,
                favorite_id,
                authenticated: !!accountability?.user
            };

            return res.json({
                data: projectWithFavorite
            });
        } catch (error) {
            console.error('Project by ID error:', error);
            next(error);
        }
    });

    router.get('/all/projects', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;

            // const page = Number(req.query.page ?? 1);
            // const limit = Number(req.query.limit ?? 25);
            // const search = req.query.search?.trim() || null;
            //
            // const offset = (page - 1) * limit;

            const { limit, offset, page, sort, filter, search, meta } = req.query;


            const projectsService = new ItemsService('projects', {
                schema,
                accountability
            });

            // const filter = {};

            if (search) {
                filter._or = [
                    { title: { _icontains: search } },
                    { slug: { _icontains: search } },
                    { summary: { _icontains: search } },
                ];
            }

            const fields = [
                '*',

                'countries.countries_id.id',
                'countries.countries_id.name',
                'countries.countries_id.slug',

                'regions.regions_id.id',
                'regions.regions_id.name',
                'regions.regions_id.slug',

                'types.types_id.id',
                'types.types_id.name',

                'sectors.sectors_id.id',
                'sectors.sectors_id.name',
                'sectors.sectors_id.slug',

                // Company relationship
                'companies.id',
                'companies.company_id.id',
                'companies.company_id.name',
                'companies.company_id.email',
                'companies.company_id.phone',
                'companies.role_id.id',
                'companies.role_id.name',
                'companies.role_id.slug',

                // Contacts
                'contacts.company_contacts_id.id',
                'contacts.company_contacts_id.name',
                'contacts.company_contacts_id.email',
                'contacts.company_contacts_id.phone',
                'contacts.company_contacts_id.company_id.name',

                'featured_image.*',
                'news.*',
            ];

            // const result = await projectsService.readByQuery({
            //     fields: fieldss,
            //     filter,
            //     sort: ['-date_created'],
            //     limit,
            //     offset,
            //     meta: ['*'], // REQUIRED for Directus 11+
            // });

            const result = await projectsService.readByQuery({
                limit: limit ? parseInt(limit, 10) : 100, // Use default or requested limit
                offset: offset ? parseInt(offset, 10) : undefined,
                page: page ? parseInt(page, 10) : undefined,
                sort,
                filter,
                search,
                fields: fields,
                meta, // Request metadata like total_count for pagination info
            });

            const projects = (result.data || []).map(project => {
                // featured image transform
                if (project.featured_image?.id) {
                    project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                    project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
                }

                // Flatten relations
                project.countries = (project.countries || [])
                    .map(c => c?.countries_id)
                    .filter(Boolean);

                project.regions = (project.regions || [])
                    .map(r => r?.regions_id)
                    .filter(Boolean);

                project.types = (project.types || [])
                    .map(t => t?.types_id)
                    .filter(Boolean);

                project.sectors = (project.sectors || [])
                    .map(s => s?.sectors_id)
                    .filter(Boolean);

                // Companies
                project.companies = (project.companies || [])
                    .filter(pc => pc.company_id)
                    .map(pc => ({
                        id: pc.id,
                        company: {
                            id: pc.company_id.id,
                            name: pc.company_id.name,
                            email: pc.company_id.email || null,
                            phone: pc.company_id.phone || null,
                        },
                        role: pc.role_id
                            ? {
                                id: pc.role_id.id,
                                name: pc.role_id.name,
                                slug: pc.role_id.slug || null,
                            }
                            : null,
                    }));

                // Contacts
                project.contacts = (project.contacts || [])
                    .map(pc => {
                        const contact = pc.company_contacts_id || {};
                        return {
                            id: contact.id || null,
                            name: contact.name || null,
                            email: contact.email || null,
                            phone: contact.phone || null,
                            role: contact.role || null,
                            company: contact.company_id?.name || null,
                        };
                    });

                return project;
            });

            const total = result.meta?.total_count ?? 0;
            const filterCount = result.meta?.filter_count ?? total;

            return res.json({
                data: projects,
                meta: {
                    page,
                    limit,
                    total_count: total,
                    filter_count: filterCount,
                    page_count: Math.ceil(total / limit),
                    authenticated: !!accountability?.user,
                },
            });

        } catch (error) {
            console.error("Get all projects error:", error);
            next(error);
        }
    });

};
