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
            @focus="listOpen = true"
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
                :key="item[relatedPrimaryKeyFieldName]"
                small
                close-icon="close"
                :disabled="disabled"
                @click:close="removeItem(item[relatedPrimaryKeyFieldName])"
            >
                <render-template
                    :collection="relatedCollection"
                    :item="item"
                    :template="displayTemplate"
                />
            </v-chip>
        </div>

        <div v-click-outside="closeList" class="m2m-dropdown">
            <div v-if="listOpen || searchQuery">
                <div v-if="loading" class="loading-container">
                    <v-progress-circular indeterminate small />
                </div>

                <div v-else-if="availableItems.length > 0" class="items-list">
                    <div
                        v-for="item in availableItems"
                        :key="item[relatedPrimaryKeyFieldName]"
                        class="item"
                        :class="{
                            selected: isSelected(
                                item[relatedPrimaryKeyFieldName],
                            ),
                        }"
                        @click="toggleItem(item)"
                    >
                        <v-checkbox
                            :model-value="
                                isSelected(item[relatedPrimaryKeyFieldName])
                            "
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
            </div>
        </div>

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

        console.log(
            "DEBUG: Props received - collection:",
            props.collection,
            "field:",
            props.field,
        );

        const items = ref([]);
        const loading = ref(false);
        const searchQuery = ref("");
        const drawerOpen = ref(false);
        const newItem = ref({});
        const saving = ref(false);
        const listOpen = ref(false);

        // Updated relationInfo with correct M2M detection + logs
        const relationInfo = computed(() => {
            console.log(
                "DEBUG: Computing relationInfo for collection:",
                props.collection,
                "field:",
                props.field,
            );

            const fieldRelations = relationsStore.getRelationsForField(
                props.collection,
                props.field,
            );
            console.log("DEBUG: Relations for field:", fieldRelations);

            if (!fieldRelations || fieldRelations.length === 0) {
                console.error(
                    "ERROR: No relations found for field:",
                    props.field,
                );
                return null;
            }

            // Find the O2M relation from the junction collection back to our collection
            const junctionO2MRelation = fieldRelations.find(
                (rel) =>
                    rel.related_collection === props.collection && // points back to projects
                    rel.collection !== props.collection, // comes from junction
            );

            if (!junctionO2MRelation) {
                console.error(
                    "ERROR: No O2M junction relation found pointing back to current collection",
                );
                return null;
            }

            console.log(
                "DEBUG: Found junction O2M relation:",
                junctionO2MRelation,
            );

            const junctionCollection = junctionO2MRelation.collection;
            console.log("DEBUG: Junction collection:", junctionCollection);

            // Now find the other relation in the junction: the M2O to the actual related items
            const otherRelationInJunction = fieldRelations.find(
                (rel) =>
                    rel.collection === junctionCollection &&
                    rel.related_collection !== props.collection,
            );

            if (!otherRelationInJunction) {
                console.error(
                    "ERROR: No related M2O relation found in junction",
                );
                return null;
            }

            console.log(
                "DEBUG: Found related M2O relation:",
                otherRelationInJunction,
            );

            return {
                junctionCollection,
                relatedCollection: otherRelationInJunction.related_collection,
                relatedField: otherRelationInJunction.field, // e.g., 'types_id' or 'sectors_id'
                // junctionField not needed unless you have extra fields in junction
            };
        });

        const relatedCollection = computed(() => {
            const col = relationInfo.value?.relatedCollection;
            console.log("DEBUG: Related collection:", col);
            return col;
        });

        const closeList = () => {
            listOpen.value = false;
            if (!searchQuery.value) {
                searchQuery.value = "";
                // optional: refetch full list
                // fetchItems();
            }
        };

        const junctionCollection = computed(() => {
            const jc = relationInfo.value?.junctionCollection;
            console.log("DEBUG: Junction collection:", jc);
            return jc;
        });

        const relatedPrimaryKeyFieldName = computed(() => {
            if (!relatedCollection.value) return "id";
            const pkField = fieldsStore.getPrimaryKeyFieldForCollection(
                relatedCollection.value,
            );
            const name = pkField?.field || "id";
            console.log("DEBUG: Related primary key field name:", name);
            return name;
        });

        // const displayTemplate = computed(() => {
        //     if (props.template) return props.template;

        //     // Prefer 'name' if it exists in related collection
        //     const fields = fieldsStore.getFieldsForCollection(
        //         relatedCollection.value,
        //     );
        //     const hasName = fields.some((f) => f.field === "name");
        //     return hasName
        //         ? "{{ name }}"
        //         : `{{ ${relatedPrimaryKeyFieldName.value} }}`;
        // });

        const displayTemplate = computed(() => {
            if (props.template) return props.template;
            return "{{ name || id }}"; // Simple, safe, works even if fields not loaded yet
        });

        // Get selected item IDs from value
        const selectedItemIds = computed(() => {
            if (!props.value || !Array.isArray(props.value)) return [];

            const relatedField = relationInfo.value?.relatedField;
            if (!relatedField) return [];

            const ids = props.value
                .map((item) => {
                    if (!item) return null;

                    // Handle different value structures
                    if (typeof item === "object") {
                        // Try to get the related item
                        const related = item[relatedField];

                        if (!related) return null;

                        // If related is an object, get its primary key
                        if (typeof related === "object" && related !== null) {
                            return related[relatedPrimaryKeyFieldName.value];
                        }

                        // If related is a primitive value (ID), return it
                        return related;
                    }

                    // If item itself is a primitive (shouldn't happen but handle it)
                    return item;
                })
                .filter((id) => id !== null && id !== undefined);

            console.log("DEBUG: Selected item IDs:", ids);
            return ids;
        });

        // Get full item data for selected items
        const selectedItemsData = computed(() => {
            const data = items.value.filter((item) =>
                selectedItemIds.value.includes(
                    item[relatedPrimaryKeyFieldName.value],
                ),
            );
            console.log("DEBUG: Selected items data:", data);
            return data;
        });

        // Get available items (all items for selection)
        const availableItems = computed(() => {
            return items.value;
        });

        const isSelected = (itemId) => {
            return selectedItemIds.value.includes(itemId);
        };

        // Fetch items from the API
        const fetchItems = async (search = "") => {
            if (!relatedCollection.value) return;

            loading.value = true;

            try {
                const params = {
                    limit: 100,
                    fields: ["*"],
                };

                // Add search filter
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
                console.log("DEBUG: Fetched items:", items.value);
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

            const itemId = item[relatedPrimaryKeyFieldName.value];
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
                console.log("DEBUG: Emitted empty array for no selections");
                return;
            }

            // Create the M2M value structure for junction table
            // The value should be an array of junction table records
            const value = selectedIds.map((id) => {
                // Find existing junction record for this ID
                const existingJunction = props.value?.find((item) => {
                    if (!item || typeof item !== "object") return false;
                    const related = item[relatedField];
                    if (typeof related === "object" && related !== null) {
                        return related[relatedPrimaryKeyFieldName.value] === id;
                    }
                    return related === id;
                });

                // If junction record exists, preserve it
                if (existingJunction) {
                    return existingJunction;
                }

                // Create new junction record
                // return {
                //     [relatedField]: id,
                // };
                return {
                    [relatedField]: { [relatedPrimaryKeyFieldName.value]: id },
                };
            });

            emit("input", value);
            console.log("DEBUG: Emitted updated value:", value);
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
                const createdId = created[relatedPrimaryKeyFieldName.value];
                updateValue([...selectedItemIds.value, createdId]);

                drawerOpen.value = false;
                newItem.value = {};
                console.log(
                    "DEBUG: Saved new item and updated selection:",
                    created,
                );
            } catch (error) {
                console.error("Error saving new item:", error);
            } finally {
                saving.value = false;
            }
        };

        // Load items on mount
        watch(
            [relationInfo, () => props.value],
            ([info, value]) => {
                if (!info?.relatedCollection) return;

                // Always load full list on mount / when relation ready
                fetchItems(searchQuery.value || "");

                // If we have existing value, ensure missing selected items are fetched
                if (value && Array.isArray(value) && value.length > 0) {
                    const missingIds = selectedItemIds.value.filter(
                        (id) =>
                            !items.value.some(
                                (item) =>
                                    item[relatedPrimaryKeyFieldName.value] ===
                                    id,
                            ),
                    );
                    if (missingIds.length > 0) {
                        // Fetch missing ones separately
                        api.get(`/items/${relatedCollection.value}`, {
                            params: {
                                filter: {
                                    [relatedPrimaryKeyFieldName.value]: {
                                        _in: missingIds,
                                    },
                                },
                                fields: ["*"],
                            },
                        })
                            .then((res) => {
                                const fetched = res.data.data || [];
                                fetched.forEach((item) => {
                                    if (
                                        !items.value.some(
                                            (i) =>
                                                i[
                                                    relatedPrimaryKeyFieldName
                                                        .value
                                                ] ===
                                                item[
                                                    relatedPrimaryKeyFieldName
                                                        .value
                                                ],
                                        )
                                    ) {
                                        items.value.push(item);
                                    }
                                });
                            })
                            .catch(console.error);
                    }
                }
            },
            { immediate: true },
        );

        // This exposes the resolved collection to interface options
        provide("relatedCollection", relatedCollection);

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
            relatedPrimaryKeyFieldName,
            createNew,
            drawerOpen,
            newItem,
            saving,
            saveNewItem,
            listOpen,
            closeList,
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
