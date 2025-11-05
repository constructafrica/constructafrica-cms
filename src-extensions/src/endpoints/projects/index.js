export default (router, { services, exceptions }) => {
    const { ItemsService, AssetsService } = services;
    const { ServiceUnavailableException } = exceptions;

    // GET /projects - List projects with minimal data
    router.get('/', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Pagination parameters
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 25;
            const offset = (page - 1) * limit;

            // Base fields for listing
            const baseFields = [
                'id',
                'title',
                'slug',
                'contract_value_usd',
                'summary',
                'estimated_project_value_usd',
                'value_range',
                'construction_start_date',
                'location',
                'current_stage',
                'status',
                'date_created',
                'date_updated',
                'featured_image.id',
                'featured_image.filename_disk',
                'featured_image.title',
                'featured_image.description'
            ];

            // Add minimal relationship fields for listing
            const relationFields = [
                'countries.countries_id.id',
                'countries.countries_id.name',
                'regions.regions_id.id',
                'regions.regions_id.name',
                'types.types_id.id',
                'types.types_id.name'
            ];

            const fields = [...baseFields, ...relationFields];

            // Build filter
            const filter = { ...req.query.filter };

            // Only show published projects by default for non-admin users
            if (!req.accountability?.admin && !filter.status) {
                filter.status = { _eq: 'published' };
            }

            // Fetch projects with pagination
            const [projects, totalCount] = await Promise.all([
                projectsService.readByQuery({
                    fields,
                    limit,
                    offset,
                    sort: req.query.sort || '-date_created',
                    filter,
                    search: req.query.search
                }),
                projectsService.readByQuery({
                    filter,
                    aggregate: { count: ['*'] }
                })
            ]);

            // Transform the response
            const transformedProjects = projects.map(project => {
                // Transform featured_image to include URLs
                if (project.featured_image) {
                    project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                    project.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}?width=400&height=300&fit=cover`;
                }

                // Flatten M2M relations to only include id and name
                if (project.countries && Array.isArray(project.countries)) {
                    project.countries = project.countries
                        .map(c => c.countries_id)
                        .filter(Boolean)
                        .map(({ id, name }) => ({ id, name }));
                }

                if (project.regions && Array.isArray(project.regions)) {
                    project.regions = project.regions
                        .map(r => r.regions_id)
                        .filter(Boolean)
                        .map(({ id, name }) => ({ id, name }));
                }

                if (project.types && Array.isArray(project.types)) {
                    project.types = project.types
                        .map(t => t.types_id)
                        .filter(Boolean)
                        .map(({ id, name }) => ({ id, name }));
                }

                return project;
            });

            const total = totalCount[0]?.count || 0;
            const totalPages = Math.ceil(total / limit);

            res.json({
                data: transformedProjects,
                meta: {
                    total,
                    page,
                    limit,
                    total_pages: totalPages,
                    has_next_page: page < totalPages,
                    has_prev_page: page > 1
                }
            });

        } catch (error) {
            next(error);
        }
    });

    // GET /projects/:id - Get single project with all details
    router.get('/:id', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Check if project exists and user has access
            let project;
            try {
                project = await projectsService.readOne(req.params.id, {
                    fields: ['id', 'status'] // Minimal fields for access check
                });
            } catch (error) {
                return res.status(404).json({
                    error: 'Project not found',
                    message: 'The requested project does not exist or you do not have access to it.'
                });
            }

            // If not admin, only allow access to published projects
            if (!req.accountability?.admin && project.status !== 'published') {
                return res.status(404).json({
                    error: 'Project not found',
                    message: 'The requested project is not available.'
                });
            }

            // Define all fields for detailed view
            const fields = [
                // Project basic info
                '*',

                // Taxonomy relationships (only id and name)
                'countries.countries_id.id',
                'countries.countries_id.name',
                'regions.regions_id.id',
                'regions.regions_id.name',
                'types.types_id.id',
                'types.types_id.name',

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

                // Media
                'featured_image.*',
                'gallery.directus_files_id.*'
            ];

            // Fetch complete project data
            const fullProject = await projectsService.readOne(req.params.id, { fields });

            // Transform featured_image
            if (fullProject.featured_image) {
                fullProject.featured_image.url = `${process.env.PUBLIC_URL}/assets/${fullProject.featured_image.id}`;
                fullProject.featured_image.thumbnail_url = `${process.env.PUBLIC_URL}/assets/${fullProject.featured_image.id}?width=400&height=300&fit=cover`;
            }

            // Transform gallery images
            if (fullProject.gallery && Array.isArray(fullProject.gallery)) {
                fullProject.gallery = fullProject.gallery.map(item => {
                    if (item.directus_files_id) {
                        const file = item.directus_files_id;
                        return {
                            id: file.id,
                            title: file.title,
                            description: file.description,
                            url: `${process.env.PUBLIC_URL}/assets/${file.id}`,
                            thumbnail_url: `${process.env.PUBLIC_URL}/assets/${file.id}?width=300&height=200&fit=cover`,
                            sort: item.sort
                        };
                    }
                    return item;
                }).filter(Boolean);
            }

            // Helper function to flatten M2M relationships and keep only id and name
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

            // Flatten all M2M relationships to only include id and name
            fullProject.countries = flattenRelationships(fullProject.countries, 'countries');
            fullProject.regions = flattenRelationships(fullProject.regions, 'regions');
            fullProject.types = flattenRelationships(fullProject.types, 'types');

            // Flatten all company relationships
            fullProject.client_owner = flattenRelationships(fullProject.client_owner, 'companies');
            fullProject.developer = flattenRelationships(fullProject.developer, 'companies');
            fullProject.authority = flattenRelationships(fullProject.authority, 'companies');
            fullProject.architect = flattenRelationships(fullProject.architect, 'companies');
            fullProject.design_consultant = flattenRelationships(fullProject.design_consultant, 'companies');
            fullProject.project_manager = flattenRelationships(fullProject.project_manager, 'companies');
            fullProject.civil_engineer = flattenRelationships(fullProject.civil_engineer, 'companies');
            fullProject.structural_engineer = flattenRelationships(fullProject.structural_engineer, 'companies');
            fullProject.mep_engineer = flattenRelationships(fullProject.mep_engineer, 'companies');
            fullProject.electrical_engineer = flattenRelationships(fullProject.electrical_engineer, 'companies');
            fullProject.geotechnical_engineer = flattenRelationships(fullProject.geotechnical_engineer, 'companies');
            fullProject.cost_consultants = flattenRelationships(fullProject.cost_consultants, 'companies');
            fullProject.quantity_surveyor = flattenRelationships(fullProject.quantity_surveyor, 'companies');
            fullProject.landscape_architect = flattenRelationships(fullProject.landscape_architect, 'companies');
            fullProject.legal_adviser = flattenRelationships(fullProject.legal_adviser, 'companies');
            fullProject.transaction_advisor = flattenRelationships(fullProject.transaction_advisor, 'companies');
            fullProject.study_consultant = flattenRelationships(fullProject.study_consultant, 'companies');
            fullProject.funding = flattenRelationships(fullProject.funding, 'companies');
            fullProject.main_contractor = flattenRelationships(fullProject.main_contractor, 'companies');
            fullProject.main_contract_bidder = flattenRelationships(fullProject.main_contract_bidder, 'companies');
            fullProject.main_contract_prequalified = flattenRelationships(fullProject.main_contract_prequalified, 'companies');
            fullProject.mep_subcontractor = flattenRelationships(fullProject.mep_subcontractor, 'companies');
            fullProject.piling_subcontractor = flattenRelationships(fullProject.piling_subcontractor, 'companies');
            fullProject.facade_subcontractor = flattenRelationships(fullProject.facade_subcontractor, 'companies');
            fullProject.lift_subcontractor = flattenRelationships(fullProject.lift_subcontractor, 'companies');
            fullProject.other_subcontractor = flattenRelationships(fullProject.other_subcontractor, 'companies');
            fullProject.operator = flattenRelationships(fullProject.operator, 'companies');
            fullProject.feed = flattenRelationships(fullProject.feed, 'companies');

            res.json({
                data: fullProject
            });

        } catch (error) {
            console.error('Error fetching project details:', error);
            next(error);
        }
    });

    // GET /projects/search - Advanced search with filtering
    router.get('/search', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            const {
                q: searchQuery,
                countries,
                regions,
                types,
                stage,
                min_value,
                max_value,
                page = 1,
                limit = 25,
                sort = '-date_created'
            } = req.query;

            const offset = (page - 1) * limit;

            // Build filter
            const filter = {
                _and: []
            };

            // Status filter (only published for non-admin)
            if (!req.accountability?.admin) {
                filter._and.push({ status: { _eq: 'published' } });
            }

            // Search query
            if (searchQuery) {
                filter._and.push({
                    _or: [
                        { title: { _icontains: searchQuery } },
                        { summary: { _icontains: searchQuery } },
                        { description: { _icontains: searchQuery } },
                        { location: { _icontains: searchQuery } }
                    ]
                });
            }

            // Country filter
            if (countries) {
                const countryIds = Array.isArray(countries) ? countries : [countries];
                filter._and.push({
                    countries: {
                        countries_id: { id: { _in: countryIds } }
                    }
                });
            }

            // Region filter
            if (regions) {
                const regionIds = Array.isArray(regions) ? regions : [regions];
                filter._and.push({
                    regions: {
                        regions_id: { id: { _in: regionIds } }
                    }
                });
            }

            // Type filter
            if (types) {
                const typeIds = Array.isArray(types) ? types : [types];
                filter._and.push({
                    types: {
                        types_id: { id: { _in: typeIds } }
                    }
                });
            }

            // Stage filter
            if (stage) {
                filter._and.push({ current_stage: { _eq: stage } });
            }

            // Value range filter
            if (min_value || max_value) {
                const valueFilter = {};
                if (min_value) valueFilter._gte = parseFloat(min_value);
                if (max_value) valueFilter._lte = parseFloat(max_value);
                filter._and.push({ contract_value_usd: valueFilter });
            }

            // Fields for search results
            const fields = [
                'id',
                'title',
                'slug',
                'contract_value_usd',
                'summary',
                'location',
                'current_stage',
                'status',
                'date_created',
                'featured_image.id',
                'featured_image.filename_disk',
                'countries.countries_id.id',
                'countries.countries_id.name',
                'types.types_id.id',
                'types.types_id.name'
            ];

            const [projects, totalCount] = await Promise.all([
                projectsService.readByQuery({
                    fields,
                    filter: filter._and.length > 0 ? filter : {},
                    limit,
                    offset,
                    sort
                }),
                projectsService.readByQuery({
                    filter: filter._and.length > 0 ? filter : {},
                    aggregate: { count: ['*'] }
                })
            ]);

            // Transform projects
            const transformedProjects = projects.map(project => {
                if (project.featured_image) {
                    project.featured_image.url = `${process.env.PUBLIC_URL}/assets/${project.featured_image.id}`;
                }

                // Flatten relationships
                if (project.countries) {
                    project.countries = project.countries
                        .map(c => c.countries_id)
                        .filter(Boolean)
                        .map(({ id, name }) => ({ id, name }));
                }

                if (project.types) {
                    project.types = project.types
                        .map(t => t.types_id)
                        .filter(Boolean)
                        .map(({ id, name }) => ({ id, name }));
                }

                return project;
            });

            const total = totalCount[0]?.count || 0;
            const totalPages = Math.ceil(total / limit);

            res.json({
                data: transformedProjects,
                meta: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: totalPages,
                    has_next_page: page < totalPages,
                    has_prev_page: page > 1
                }
            });

        } catch (error) {
            next(error);
        }
    });
};