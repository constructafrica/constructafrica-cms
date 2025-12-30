export default ({ action }, { services, getSchema }) => {
    const { ItemsService } = services;

    console.log('Auto Slug Hook: Registered and listening for events');

    // Define collections that should have auto-generated slugs
    const slugCollections = {
        projects: {
            sourceField: 'title', // Field to generate slug from
            slugField: 'slug',    // Field to store slug in
            unique: true,         // Ensure slugs are unique
            maxLength: 100        // Maximum slug length
        },
        companies: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        main_news: {
            sourceField: 'title',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        tenders: {
            sourceField: 'title',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        experts_analysts: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        blog: {
            sourceField: 'title',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        events: {
            sourceField: 'title',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        countries: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        sectors: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        sub_sectors: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        regions: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        project_status: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        project_stages: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        },
        directus_roles: {
            sourceField: 'name',
            slugField: 'slug',
            unique: true,
            maxLength: 100
        }
    };

    // Hook into create events for all slug collections
    Object.keys(slugCollections).forEach(collection => {
        action(`${collection}.items.create`, async (meta, { accountability }) => {
            await generateSlugForItem(collection, meta, accountability, 'create');
        });

        // Also handle update events if slug is empty or being updated
        action(`${collection}.items.update`, async (meta, { accountability }) => {
            await generateSlugForItem(collection, meta, accountability, 'update');
        });
    });

    async function generateSlugForItem(collection, meta, accountability, actionType) {
        try {
            console.log(`Auto Slug: Processing ${actionType} for ${collection}`, meta);

            const config = slugCollections[collection];
            if (!config) return;

            const schema = await getSchema();
            const collectionService = new ItemsService(collection, {
                schema: schema,
                accountability: accountability,
            });

            // Get the item data
            let itemData;
            if (actionType === 'create') {
                itemData = meta.payload;
            } else if (actionType === 'update') {
                const currentItem = await collectionService.readOne(meta.key, {
                    fields: [config.slugField, config.sourceField]
                });
                itemData = { ...currentItem, ...meta.payload };
            }

            // If slug is already provided and not empty, skip generation
            if (itemData[config.slugField] && itemData[config.slugField].trim() !== '') {
                console.log(`Auto Slug: ${collection} already has slug: ${itemData[config.slugField]}`);
                return;
            }

            // Get the source field value for slug generation
            const sourceValue = itemData[config.sourceField];
            if (!sourceValue || sourceValue.trim() === '') {
                console.warn(`Auto Slug: Cannot generate slug for ${collection} - source field "${config.sourceField}" is empty`);
                return;
            }

            console.log(`Auto Slug: Generating slug for ${collection} from: "${sourceValue}"`);

            // Generate base slug
            let baseSlug = generateSlug(sourceValue, config.maxLength);

            // Ensure uniqueness if required
            let finalSlug = baseSlug;
            if (config.unique) {
                finalSlug = await ensureUniqueSlug(collection, config.slugField, baseSlug, collectionService, meta.key);
            }

            console.log(`Auto Slug: Generated slug for ${collection}: ${finalSlug}`);

            // Update the item with the generated slug
            if (actionType === 'create') {
                meta.payload[config.slugField] = finalSlug;
            } else if (actionType === 'update') {
                // For updates, we need to update the payload
                meta.payload[config.slugField] = finalSlug;
            }

        } catch (error) {
            console.error(`Auto Slug: Error generating slug for ${collection}:`, error);
        }
    }

    function generateSlug(text, maxLength = 100) {
        if (!text) return '';

        // Convert to lowercase
        let slug = text.toLowerCase();

        // Replace spaces and special characters with hyphens
        slug = slug
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars except -
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start of text
            .replace(/-+$/, '');            // Trim - from end of text

        // Truncate to max length while preserving word boundaries
        if (slug.length > maxLength) {
            slug = slug.substring(0, maxLength);
            // Don't end with a hyphen
            if (slug.endsWith('-')) {
                slug = slug.substring(0, slug.length - 1);
            }
        }

        // If slug is empty after processing, generate a fallback
        if (!slug || slug.trim() === '') {
            slug = 'item-' + Date.now();
        }

        return slug;
    }

    async function ensureUniqueSlug(collection, slugField, baseSlug, service, currentItemId = null) {
        let slug = baseSlug;
        let counter = 1;
        let isUnique = false;

        while (!isUnique && counter < 100) { // Safety limit to prevent infinite loops
            try {
                // Check if slug exists
                const existingItems = await service.readByQuery({
                    filter: {
                        [slugField]: { _eq: slug }
                    },
                    limit: 1,
                    fields: ['id']
                });

                // If no items found, or if the only item found is the current one being updated
                const slugExists = existingItems.length > 0 &&
                    (currentItemId ? existingItems[0].id !== currentItemId : true);

                if (!slugExists) {
                    isUnique = true;
                } else {
                    // Slug exists, append counter
                    slug = `${baseSlug}-${counter}`;
                    counter++;
                }
            } catch (error) {
                console.error(`Auto Slug: Error checking slug uniqueness for ${collection}:`, error);
                // If we can't check uniqueness, just use the base slug
                isUnique = true;
            }
        }

        return slug;
    }
};