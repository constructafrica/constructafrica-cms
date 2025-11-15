export default (router, { services, exceptions }) => {
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

    router.get('/', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Get user's access permissions
            // const userAccess = await getUserAccessibleFilters(req.accountability);

            // Check if user has access
            // if (!userAccess.hasAccess && req.accountability?.user) {
            //     return res.status(403).json({
            //         success: false,
            //         error: 'Projects subscription required',
            //         message: 'You need an active Projects subscription to access this content',
            //
            // }

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
                    'featured_image.id',
                    'featured_image.filename_disk',
                    'featured_image.title',
                    'featured_image.filesize',
                ],
                limit: groupBy ? -1 : limit, // No limit when grouping
                page: groupBy ? 1 : page,
                filter: req.query.filter || {},
                meta: ['total_count', 'filter_count']
            });

            const projects = result.data || result;
            const meta = result.meta || {};

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
                // const originalFunding = project.funding ? [...project.funding] : [];
                // const originalCompanies = project.companies ? [...project.companies] : [];
                // const originalClientOwner = project.client_owner ? [...project.client_owner] : [];
                // const originalDeveloper = project.developer ? [...project.developer] : [];

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
                // if (project.funding && Array.isArray(project.funding)) {
                //     project.funding = project.funding.map(f => f.funding_id).filter(Boolean);
                // }
                // if (project.companies && Array.isArray(project.companies)) {
                //     project.companies = project.companies.map(c => c.companies_id).filter(Boolean);
                // }
                // if (project.client_owner && Array.isArray(project.client_owner)) {
                //     project.client_owner = project.client_owner.map(c => c.companies_id).filter(Boolean);
                // }
                // if (project.developer && Array.isArray(project.developer)) {
                //     project.developer = project.developer.map(d => d.companies_id).filter(Boolean);
                // }

                // Store originals for grouping
                if (groupBy) {
                    project._originals = {
                        countries: originalCountries,
                        regions: originalRegions,
                        types: originalTypes,
                        sectors: originalSectors,
                        // funding: originalFunding,
                        // companies: originalCompanies,
                        // client_owner: originalClientOwner,
                        // developer: originalDeveloper
                    };
                }

                return project;
            });

            // If grouping is requested, group the projects
            if (groupBy) {
                const grouped = groupProjects(transformedProjects, groupBy);

                // res.json({
                //     data: grouped,
                //     meta: {
                //         total: transformedProjects.length,
                //         groupBy: groupBy,
                //         groups: grouped.length
                //     }
                // });
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
                // Return paginated response
                res.json({
                    data: transformedProjects,
                    meta: {
                        total_count: meta.total_count || meta.filter_count || transformedProjects.length,
                        filter_count: meta.filter_count || transformedProjects.length,
                        page: page,
                        limit: limit,
                        page_count: Math.ceil((meta.filter_count || transformedProjects.length) / limit)
                    }
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

                return {
                    id: project.id,
                    title: project.title,
                    slug: project.slug,
                    summary: project.summary,
                    featured_image: project.featured_image
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
                    // 'featured_image.id',
                    // 'featured_image.filename_disk',
                    // 'featured_image.title',
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
            // const transformedProjects = projects.map(project => {
            //     if (project.featured_image && typeof project.featured_image === 'object' && project.featured_image.id) {
            //         project.featured_image = {
            //             id: project.featured_image.id,
            //             url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`,
            //             thumbnail_url: `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`,
            //             title: project.featured_image.title
            //         };
            //     }
            //
            //     return {
            //         id: project.id,
            //         title: project.title,
            //         slug: project.slug,
            //         summary: project.summary,
            //         featured_image: project.featured_image
            //     };
            // });

            res.json({
                data: projects,
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
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Fetch ALL data for single project endpoint
            const project = await projectsService.readOne(req.params.id, {
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
                    'featured_image.*'
                ]
            });

            const f = [
                // Company relationships (only id and name)
                'client_owner.companies_id.id',
                'client_owner.companies_id.name',
                'developer.companies_id.id',
                'developer.companies_id.name',
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
                'funding.companies_id.id',
                'funding.companies_id.name',
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
            ];

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

            res.json({
                data: project
            });
        } catch (error) {
            next(error);
        }
    });
};