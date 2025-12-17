export default (router, { services, exceptions, getSchema, database}) => {
    const { ItemsService, AssetsService } = services;

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

            const projectIds = projects.map(project => project.id);

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

            const favoritesMap = new Map();
            userFavorites.forEach(fav => {
                favoritesMap.set(fav.item_id, fav.id);
            });

            return projects.map(project => ({
                ...project,
                is_favorited: favoritesMap.has(project.id),
                favorite_id: favoritesMap.get(project.id) || null
            }));
        } catch (error) {
            console.error('Error in addFavoritesStatus:', error);
            throw error;
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
                        name: r.sectors_id?.name || 'Unknown Sector',
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

            if (groupKeys.length === 0) {
                groupKeys = [{ id: 'unknown', name: `Unknown ${groupBy}`, data: null }];
            }

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
                const cleanProject = { ...project };
                delete cleanProject._originals;

                group.projects.push(cleanProject);
                group.count++;

                if (project.contract_value_usd) {
                    group.totalValue += parseFloat(project.contract_value_usd) || 0;
                }
            });
        });

        return Array.from(groups.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }

    router.get('/', async (req, res, next) => {
        try {
            const { accountability } = req;
            const schema = await getSchema();
            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: req.accountability
            });

            const groupBy = req.query.groupBy;
            const limit = parseInt(req.query.limit) || 25;
            const page = parseInt(req.query.page) || 1;
            const offset = (page - 1) * limit;

            // Get total count using database connection directly
            let totalCount = 0;
            let filterCount = 0;

            try {
                const filterObj = req.query.filter || {};

                // Access the database connection through the service
                const knex = database;

                // Build count query
                let countQuery = knex('projects').count('* as count');

                // Note: For complex filters, you may need to use Directus filter helpers
                // For now, this gets the total count without filters
                const totalResult = await countQuery;
                totalCount = parseInt(totalResult[0]?.count) || 0;

                // For filtered count, if you have filters, you'd need to apply them
                // This is a simplified version - expand based on your filter needs
                if (Object.keys(filterObj).length > 0) {
                    // You can implement filter logic here or use the service
                    filterCount = totalCount; // Simplified - same as total for now
                } else {
                    filterCount = totalCount;
                }

                console.log('Total count from DB:', totalCount);
            } catch (countError) {
                console.error('Error getting count:', countError);
                // Fallback to projects length
                totalCount = projects?.length || 0;
                filterCount = totalCount;
            }

            // Fetch projects
            const projects = await projectsService.readByQuery({
                fields: [
                    'id',
                    'title',
                    'slug',
                    'contract_value_usd',
                    'summary',
                    'description',
                    'news_updated_at',
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
                    'subsector.subsectors_id.id',
                    'subsector.subsectors_id.name',
                    'current_status',
                    'current_status.id',
                    'current_status.name',
                    'current_status.slug',
                    'featured_image',
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                    'featured_image.filesize',

                    // 'user_created.id',
                    // 'user_created.first_name',
                    // 'user_created.last_name',
                    // 'user_created.email',
                    // 'user_created.avatar',
                    // 'user_created.avatar.id',
                    // 'user_created.avatar.filename_disk',
                    // 'user_created.avatar.title',
                    // 'user_created.avatar.filesize',
                ],
                limit: groupBy ? -1 : limit,
                sort: ['-date_created'],
                offset: groupBy ? 0 : offset,
                filter: req.query.filter || {},
            });

            // Build proper meta object
            const meta = {
                total_count: totalCount,
                filter_count: filterCount,
                limit: limit,
                page: page,
                page_count: Math.ceil(totalCount / limit)
            };

            console.log('Final meta:', meta);

            // Transform projects
            const transformedProjects = projects.map(project => {
                // Check if project has recent news update (within last 30 days)
                let has_recent_update = false;
                if (project.news_updated_at) {
                    const newsUpdateDate = new Date(project.news_updated_at);
                    const thirtyDaysAgo = new Date();
                    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                    has_recent_update = newsUpdateDate > thirtyDaysAgo;
                }

                // Transform featured_image
                if (project.featured_image) {
                    if (typeof project.featured_image === 'object' && project.featured_image.id) {
                        project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                        project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
                    }
                }

                // Store original M2M data before flattening
                const originalCountries = project.countries ? [...project.countries] : [];
                const originalRegions = project.regions ? [...project.regions] : [];
                const originalTypes = project.types ? [...project.types] : [];
                const originalSectors = project.sectors ? [...project.sectors] : [];

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

                // Store originals for grouping
                if (groupBy) {
                    project._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        types: originalTypes,
                        sectors: originalSectors,
                    };
                }

                // Add has_recent_update field
                project.has_recent_update = has_recent_update;

                return project;
            });

            // Handle grouping
            if (groupBy) {
                const grouped = groupProjects(transformedProjects, groupBy);
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

            // Add favorites status
            let finalProjects;
            if (accountability?.user) {
                finalProjects = await addFavoritesStatus(
                    transformedProjects,
                    accountability.user,
                    schema,
                    req.accountability
                );
            } else {
                finalProjects = transformedProjects.map(project => ({
                    ...project,
                    is_favorited: false,
                    favorite_id: null
                }));
            }

            return res.json({
                data: finalProjects,
                meta: meta
            });

        } catch (error) {
            console.error("Projects error:", error);
            next(error);
        }
    });

    router.get('/:id', async (req, res, next) => {
        try {
            const schema = await getSchema();
            const { accountability } = req;
            const projectId = req.params.id;

            const projectsService = new ItemsService('projects', {
                schema: schema,
                accountability: req.accountability
            });

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
                    'current_status.id',
                    'current_status.name',
                    'current_status.slug',
                    'companies.id',
                    'companies.company_id.id',
                    'companies.company_id.name',
                    'companies.company_id.email',
                    'companies.company_id.phone',
                    'companies.role_id.id',
                    'companies.role_id.name',
                    'companies.role_id.slug',
                    'contacts.company_contacts_id.id',
                    'contacts.company_contacts_id.name',
                    'contacts.company_contacts_id.company',
                    'contacts.company_contacts_id.company.id',
                    'contacts.company_contacts_id.company.name',
                    'contacts.company_contacts_id.company.email',
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

            // Transform companies
            if (project.companies && Array.isArray(project.companies)) {
                project.companies = project.companies
                    .filter(pc => pc.company_id)
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

            // Transform contacts
            if (project.contacts && Array.isArray(project.contacts)) {
                project.contacts = project.contacts
                    .filter(pc => pc.company_contacts_id)
                    .map(pc => ({
                        id: pc.company_contacts_id.id,
                        name: pc.company_contacts_id.name || null,
                        company: {
                            id: pc.company_contacts_id.company.id || null,
                            name: pc.company_contacts_id.company.name || null,
                            email: pc.company_contacts_id.company.email || null,
                        },
                        email: pc.company_contacts_id.email || null,
                        phone: pc.company_contacts_id.phone || null,
                        role: pc.company_contacts_id.role || null,
                    }));
            } else {
                project.contacts = [];
            }

            // Handle favorites
            let is_favorited = false;
            let favorite_id = null;

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
                                { item_id: { _eq: projectId } },
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
};