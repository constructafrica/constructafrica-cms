<template>
    <v-notice v-if="!relationInfo" type="warning">
        {{ t("relationship_not_setup") }}
    </v-notice>
    <div v-else class="m2m-dropdown">
        <v-input
            v-model="searchQuery"
            :placeholder="t('search_items')"
            :disabled="disabled"
            @update:model-value="onSearchInput"
        >
            <template #prepend>
                <v-icon name="search" />
            </template>
            <template #append>
                <v-icon
                    v-if="searchQuery"
                    name="close"
                    clickable
                    @click="clearSearch"
                />
            </template>
        </v-input>

        <div v-if="selectedItemsData.length > 0" class="selected-items">
            <v-chip
                v-for="item in selectedItemsData"
                :key="item[relatedPrimaryKey]"
                small
                :disabled="disabled"
                @click:close="removeItem(item[relatedPrimaryKey])"
            >
                <render-template
                    :collection="relatedCollection"
                    :item="item"
                    :template="displayTemplate"
                />
            </v-chip>
        </div>

        <div v-if="loading" class="loading-container">
            <v-progress-circular indeterminate small />
        </div>

        <div v-else-if="availableItems.length > 0" class="items-list">
            <div
                v-for="item in availableItems"
                :key="item[relatedPrimaryKey]"
                class="item"
                :class="{ selected: isSelected(item[relatedPrimaryKey]) }"
                @click="toggleItem(item)"
            >
                <v-checkbox
                    :model-value="isSelected(item[relatedPrimaryKey])"
                    :disabled="disabled"
                    @click.stop
                />
                <div class="item-content">
                    <render-template
                        :collection="relatedCollection"
                        :item="item"
                        :template="displayTemplate"
                    />
                </div>
            </div>
        </div>

        <div v-else-if="searchQuery && !loading" class="no-results">
            {{ t("no_items_found") }}
        </div>

        <v-button
            v-if="enableCreate"
            small
            class="add-new"
            :disabled="disabled"
            @click="createNew"
        >
            <v-icon name="add" small />
            {{ t("create_new") }}
        </v-button>

        <v-drawer
            v-model="drawerOpen"
            :title="t('create_item')"
            persistent
            @cancel="drawerOpen = false"
        >
            <template #actions>
                <v-button secondary @click="drawerOpen = false">
                    {{ t("cancel") }}
                </v-button>
                <v-button :loading="saving" @click="saveNewItem">
                    {{ t("save") }}
                </v-button>
            </template>

            <div class="drawer-content">
                <v-form
                    v-model="newItem"
                    :collection="relatedCollection"
                    :primary-key="'+'"
                    :loading="false"
                    :disabled="false"
                />
            </div>
        </v-drawer>
    </div>
</template>

<script>
import { useApi, useStores } from "@directus/extensions-sdk";
import { defineComponent, ref, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { debounce } from "lodash";

export default defineComponent({
    props: {
        value: {
            type: Array,
            default: () => [],
        },
        collection: {
            type: String,
            required: true,
        },
        field: {
            type: String,
            required: true,
        },
        primaryKey: {
            type: [String, Number],
            required: true,
        },
        disabled: {
            type: Boolean,
            default: false,
        },
        template: {
            type: String,
            default: null,
        },
        enableCreate: {
            type: Boolean,
            default: false,
        },
        filter: {
            type: Object,
            default: null,
        },
    },
    emits: ["input"],
    setup(props, { emit }) {
        const { t } = useI18n();
        const api = useApi();
        const { useRelationsStore, useFieldsStore } = useStores();
        const relationsStore = useRelationsStore();
        const fieldsStore = useFieldsStore();

        const items = ref([]);
        const loading = ref(false);
        const searchQuery = ref("");
        const drawerOpen = ref(false);
        const newItem = ref({});
        const saving = ref(false);

        // Get relation info for M2M
        const relationInfo = computed(() => {
            const relations = relationsStore.getRelationsForField(
                props.collection,
                props.field,
            );

            // M2M has two relations - one to junction, one from junction to related
            const junctionRelation = relations.find(
                (relation) =>
                    relation.collection === props.collection &&
                    relation.field === props.field,
            );

            if (!junctionRelation) return null;

            // Find the relation from junction to related collection
            const junctionCollection = junctionRelation.related_collection;
            const junctionField = junctionRelation.meta?.one_field;

            const relatedRelation = relationsStore
                .getRelationsForCollection(junctionCollection)
                .find(
                    (relation) =>
                        relation.collection === junctionCollection &&
                        relation.field !== junctionField &&
                        relation.related_collection,
                );

            return {
                junctionRelation,
                relatedRelation,
                junctionCollection,
                relatedCollection: relatedRelation?.related_collection,
                junctionField: junctionRelation.field,
                relatedField: relatedRelation?.field,
            };
        });

        const relatedCollection = computed(() => {
            return relationInfo.value?.relatedCollection;
        });

        const junctionCollection = computed(() => {
            return relationInfo.value?.junctionCollection;
        });

        const relatedPrimaryKey = computed(() => {
            if (!relatedCollection.value) return null;
            return fieldsStore.getPrimaryKeyFieldForCollection(
                relatedCollection.value,
            );
        });

        const displayTemplate = computed(() => {
            if (props.template) return props.template;
            if (relatedPrimaryKey.value) {
                return `{{ ${relatedPrimaryKey.value} }}`;
            }
            return "{{ id }}";
        });

        // Get selected item IDs from value
        const selectedItemIds = computed(() => {
            if (!props.value || !Array.isArray(props.value)) return [];

            const relatedField = relationInfo.value?.relatedField;
            if (!relatedField) return [];

            return props.value
                .map((item) => {
                    if (typeof item === "object" && item !== null) {
                        // Handle nested object structure
                        const related = item[relatedField];
                        if (typeof related === "object" && related !== null) {
                            return related[relatedPrimaryKey.value];
                        }
                        return related;
                    }
                    return item;
                })
                .filter(Boolean);
        });

        // Get full item data for selected items
        const selectedItemsData = computed(() => {
            return items.value.filter((item) =>
                selectedItemIds.value.includes(item[relatedPrimaryKey.value]),
            );
        });

        // Get available items (all items for selection)
        const availableItems = computed(() => {
            return items.value;
        });

        const isSelected = (itemId) => {
            return selectedItemIds.value.includes(itemId);
        };

        // Fetch items from the API (always queries database)
        const fetchItems = async (search = "") => {
            if (!relatedCollection.value) return;

            loading.value = true;

            try {
                const params = {
                    limit: 100,
                    fields: ["*"],
                };

                // Add search filter (queries database)
                if (search) {
                    const searchableFields = fieldsStore
                        .getFieldsForCollection(relatedCollection.value)
                        .filter(
                            (field) =>
                                ["string", "text"].includes(field.type) &&
                                !field.meta?.hidden,
                        )
                        .map((field) => field.field);

                    if (searchableFields.length > 0) {
                        params.filter = {
                            _or: searchableFields.map((field) => ({
                                [field]: {
                                    _contains: search,
                                },
                            })),
                        };
                    }
                }

                // Add custom filter if provided
                if (props.filter) {
                    params.filter = params.filter
                        ? { _and: [params.filter, props.filter] }
                        : props.filter;
                }

                const response = await api.get(
                    `/items/${relatedCollection.value}`,
                    { params },
                );
                items.value = response.data.data || [];
            } catch (error) {
                console.error("Error fetching items:", error);
                items.value = [];
            } finally {
                loading.value = false;
            }
        };

        // Debounced search input handler
        const onSearchInput = debounce((value) => {
            fetchItems(value);
        }, 300);

        const clearSearch = () => {
            searchQuery.value = "";
            fetchItems();
        };

        const toggleItem = (item) => {
            if (props.disabled) return;

            const itemId = item[relatedPrimaryKey.value];
            const isCurrentlySelected = isSelected(itemId);

            let newSelectedIds;
            if (isCurrentlySelected) {
                newSelectedIds = selectedItemIds.value.filter(
                    (id) => id !== itemId,
                );
            } else {
                newSelectedIds = [...selectedItemIds.value, itemId];
            }

            updateValue(newSelectedIds);
        };

        const removeItem = (itemId) => {
            if (props.disabled) return;
            const newSelectedIds = selectedItemIds.value.filter(
                (id) => id !== itemId,
            );
            updateValue(newSelectedIds);
        };

        const updateValue = (selectedIds) => {
            const relatedField = relationInfo.value?.relatedField;
            if (!relatedField) return;

            if (!selectedIds || selectedIds.length === 0) {
                emit("input", []);
                return;
            }

            // Create the M2M value structure
            const value = selectedIds.map((id) => ({
                [relatedField]: id,
            }));

            emit("input", value);
        };

        const createNew = () => {
            newItem.value = {};
            drawerOpen.value = true;
        };

        const saveNewItem = async () => {
            if (!relatedCollection.value) return;

            saving.value = true;

            try {
                const response = await api.post(
                    `/items/${relatedCollection.value}`,
                    newItem.value,
                );
                const created = response.data.data;

                // Add to items list
                items.value.unshift(created);

                // Add to selection
                const createdId = created[relatedPrimaryKey.value];
                updateValue([...selectedItemIds.value, createdId]);

                drawerOpen.value = false;
                newItem.value = {};
            } catch (error) {
                console.error("Error saving new item:", error);
            } finally {
                saving.value = false;
            }
        };

        // Load items on mount
        watch(
            () => props.collection,
            () => {
                fetchItems();
            },
            { immediate: true },
        );

        // Fetch selected items if they're not in the list
        watch(
            () => props.value,
            async (newValue) => {
                if (
                    !newValue ||
                    !Array.isArray(newValue) ||
                    newValue.length === 0 ||
                    !relatedCollection.value ||
                    !relatedPrimaryKey.value
                )
                    return;

                const missingIds = selectedItemIds.value.filter((id) => {
                    return !items.value.some(
                        (item) => item[relatedPrimaryKey.value] === id,
                    );
                });

                if (missingIds.length > 0) {
                    try {
                        const response = await api.get(
                            `/items/${relatedCollection.value}`,
                            {
                                params: {
                                    filter: {
                                        [relatedPrimaryKey.value]: {
                                            _in: missingIds,
                                        },
                                    },
                                    fields: ["*"],
                                },
                            },
                        );

                        const fetchedItems = response.data.data || [];

                        // Add to items list without duplicates
                        fetchedItems.forEach((fetchedItem) => {
                            const exists = items.value.some(
                                (item) =>
                                    item[relatedPrimaryKey.value] ===
                                    fetchedItem[relatedPrimaryKey.value],
                            );
                            if (!exists) {
                                items.value.push(fetchedItem);
                            }
                        });
                    } catch (error) {
                        console.error("Error fetching selected items:", error);
                    }
                }
            },
            { immediate: true },
        );

        return {
            t,
            relationInfo,
            items,
            loading,
            searchQuery,
            selectedItemsData,
            availableItems,
            isSelected,
            onSearchInput,
            clearSearch,
            toggleItem,
            removeItem,
            displayTemplate,
            relatedCollection,
            relatedPrimaryKey,
            createNew,
            drawerOpen,
            newItem,
            saving,
            saveNewItem,
        };
    },
});
</script>

<style scoped>
.m2m-dropdown {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.selected-items {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px;
    background-color: var(--theme--background-subdued);
    border-radius: var(--theme--border-radius);
    min-height: 40px;
}

.loading-container {
    display: flex;
    justify-content: center;
    padding: 20px;
}

.items-list {
    max-height: 300px;
    overflow-y: auto;
    border: var(--theme--border-width) solid
        var(--theme--form--field--input--border-color);
    border-radius: var(--theme--border-radius);
}

.item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background-color var(--fast) var(--transition);
    border-bottom: var(--theme--border-width) solid
        var(--theme--form--field--input--border-color);
}

.item:last-child {
    border-bottom: none;
}

.item:hover {
    background-color: var(--theme--background-subdued);
}

.item.selected {
    background-color: var(--theme--primary-background);
}

.item-content {
    flex: 1;
}

.no-results {
    padding: 20px;
    text-align: center;
    color: var(--theme--foreground-subdued);
}

.add-new {
    align-self: flex-start;
}

.drawer-content {
    padding: var(--content-padding);
    padding-top: 0;
    padding-bottom: var(--content-padding-bottom);
}

:deep(.v-chip) {
    cursor: pointer;
}
</style>
