export default (router, { services, exceptions }) => {
    const { ItemsService, AssetsService } = services;
    const { ServiceUnavailableException } = exceptions;

    router.get('/', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            // Check if grouping is requested
            const groupBy = req.query.groupBy; // e.g., 'country', 'region', 'type'

            // Fetch projects with all relations expanded
            const projects = await projectsService.readByQuery({
                fields: [
                    '*',
                    'countries.countries_id.*', // M2M: get actual country data
                    'regions.regions_id.*', // M2M: get actual region data
                    'types.types_id.*',
                    // 'funding.funding_id.*',
                    // 'client_owner.companies_id.*',
                    // 'developer.companies_id.*',
                    // 'companies.companies_id.*',
                    // 'authority.*',
                    // 'architect.*',
                    // 'design_consultant.*',
                    // 'project_manager.*',
                    // 'civil_engineer.*',
                    // 'structural_engineer.*',
                    // 'mep_engineer.*',
                    // 'electrical_engineer.*',
                    // 'geotechnical_engineer.*',
                    // 'cost_consultants.*',
                    // 'quantity_surveyor.*',
                    // 'landscape_architect.*',
                    // 'legal_adviser.*',
                    // 'transaction_advisor.*',
                    // 'study_consultant.*',
                    // 'main_contractor.*',
                    // 'main_contract_bidder.*',
                    // 'main_contract_prequalified.*',
                    // 'mep_subcontractor.*',
                    // 'piling_subcontractor.*',
                    // 'facade_subcontractor.*',
                    // 'lift_subcontractor.*',
                    // 'other_subcontractor.*',
                    // 'operator.*',
                    // 'feed.*',
                    'featured_image.*'
                ],
                limit: req.query.limit || -1, // -1 for no limit when grouping
                page: req.query.page || 1,
                filter: req.query.filter || {}
            });

            // Transform the response to include full asset URLs and flatten M2M relations
            const transformedProjects = projects.map(project => {
                // Transform featured_image to include full URL
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
                const originalFunding = project.funding ? [...project.funding] : [];
                const originalCompanies = project.companies ? [...project.companies] : [];
                const originalClientOwner = project.client_owner ? [...project.client_owner] : [];
                const originalDeveloper = project.developer ? [...project.developer] : [];

                // Flatten M2M relations to return just the related objects
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

                // Store originals for grouping
                project._originals = {
                    countries: originalCountries,
                    regions: originalRegions,
                    types: originalTypes,
                    funding: originalFunding,
                    companies: originalCompanies,
                    client_owner: originalClientOwner,
                    developer: originalDeveloper
                };

                return project;
            });

            // If grouping is requested, group the projects
            if (groupBy) {
                const grouped = groupProjects(transformedProjects, groupBy);

                res.json({
                    data: grouped,
                    meta: {
                        total: transformedProjects.length,
                        groupBy: groupBy,
                        groups: grouped.length
                    }
                });
            } else {
                // Remove _originals from response if not grouping
                transformedProjects.forEach(p => delete p._originals);

                res.json({
                    data: transformedProjects,
                    meta: {
                        total: projects.length,
                        page: parseInt(req.query.page) || 1,
                        limit: parseInt(req.query.limit) || 100
                    }
                });
            }
        } catch (error) {
            next(error);
        }
    });

    // Helper function to group projects
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
                if (project.value) {
                    group.totalValue += parseFloat(project.value) || 0;
                }
            });
        });

        // Convert Map to Array and sort by name
        return Array.from(groups.values()).sort((a, b) =>
            a.name.localeCompare(b.name)
        );
    }

    router.get('/:id', async (req, res, next) => {
        try {
            const projectsService = new ItemsService('projects', {
                schema: req.schema,
                accountability: req.accountability
            });

            const project = await projectsService.readOne(req.params.id, {
                fields: [
                    '*',
                    'countries.countries_id.*',
                    'regions.regions_id.*',
                    // 'types.types_id.*',
                    // 'funding.funding_id.*',
                    // 'client_owner.companies_id.*',
                    // 'developer.companies_id.*',
                    // 'companies.companies_id.*',
                    // 'authority.*',
                    // 'architect.*',
                    // 'design_consultant.*',
                    // 'project_manager.*',
                    // 'civil_engineer.*',
                    // 'structural_engineer.*',
                    // 'mep_engineer.*',
                    // 'electrical_engineer.*',
                    // 'geotechnical_engineer.*',
                    // 'cost_consultants.*',
                    // 'quantity_surveyor.*',
                    // 'landscape_architect.*',
                    // 'legal_adviser.*',
                    // 'transaction_advisor.*',
                    // 'study_consultant.*',
                    // 'main_contractor.*',
                    // 'main_contract_bidder.*',
                    // 'main_contract_prequalified.*',
                    // 'mep_subcontractor.*',
                    // 'piling_subcontractor.*',
                    // 'facade_subcontractor.*',
                    // 'lift_subcontractor.*',
                    // 'other_subcontractor.*',
                    // 'operator.*',
                    // 'feed.*',
                    'featured_image.*'
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

            res.json({
                data: project
            });
        } catch (error) {
            next(error);
        }
    });
};