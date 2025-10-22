FROM directus/directus:11.12.0

# COPY ./extensions /directus/extensions
# Copy snapshots for schema migration
COPY ./snapshots /directus/snapshots