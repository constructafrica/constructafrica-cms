<template>
    <v-notice v-if="!relationInfo" type="warning">
        {{ t("relationship_not_setup") }}
    </v-notice>
    <div v-else class="m2o-dropdown">
        <!-- Selected value display / Dropdown trigger -->
        <div
            class="dropdown-trigger"
            :class="{ disabled: disabled, open: isOpen }"
            @click="toggleDropdown"
        >
            <div v-if="selectedItemData" class="selected-value">
                <render-template
                    :collection="relatedCollection"
                    :item="selectedItemData"
                    :template="displayTemplate"
                />
            </div>
            <div v-else class="placeholder">
                {{ t("select_an_item") }}
            </div>
            <div class="dropdown-icons">
                <v-icon
                    v-if="selectedItem && !disabled"
                    name="close"
                    small
                    clickable
                    @click.stop="clearSelection"
                />
                <v-icon :name="isOpen ? 'expand_less' : 'expand_more'" small />
            </div>
        </div>

        <!-- Dropdown menu -->
        <div v-if="isOpen" class="dropdown-menu">
            <v-input
                v-model="searchQuery"
                :placeholder="t('search_items')"
                @update:model-value="onSearchInput"
                @click.stop
            >
                <template #prepend>
                    <v-icon name="search" />
                </template>
                <template #append>
                    <v-icon
                        v-if="searchQuery"
                        name="close"
                        clickable
                        @click.stop="clearSearch"
                    />
                </template>
            </v-input>

            <div v-if="loading" class="loading-container">
                <v-progress-circular indeterminate small />
            </div>

            <div v-else-if="items.length > 0" class="items-list">
                <div
                    v-for="item in items"
                    :key="item[relatedPrimaryKey]"
                    class="item"
                    :class="{
                        selected: selectedItem === item[relatedPrimaryKey],
                    }"
                    @click="selectItem(item)"
                >
                    <render-template
                        :collection="relatedCollection"
                        :item="item"
                        :template="displayTemplate"
                    />
                    <v-icon
                        v-if="selectedItem === item[relatedPrimaryKey]"
                        name="check"
                        class="check-icon"
                        small
                    />
                </div>
            </div>

            <div v-else-if="searchQuery" class="no-results">
                {{ t("no_items_found") }}
            </div>

            <v-button
                v-if="enableCreate"
                small
                class="add-new"
                @click.stop="createNew"
            >
                <v-icon name="add" small />
                {{ t("create_new") }}
            </v-button>
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
import {
    defineComponent,
    ref,
    computed,
    watch,
    onMounted,
    onUnmounted,
} from "vue";
import { useI18n } from "vue-i18n";
import { debounce } from "lodash";

export default defineComponent({
    props: {
        value: {
            type: [String, Number],
            default: null,
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
        const isOpen = ref(false);
        const drawerOpen = ref(false);
        const newItem = ref({});
        const saving = ref(false);

        // Get relation info for M2O
        const relationInfo = computed(() => {
            const relations = relationsStore.getRelationsForField(
                props.collection,
                props.field,
            );

            const m2oRelation = relations.find(
                (relation) =>
                    relation.collection === props.collection &&
                    relation.field === props.field,
            );

            return m2oRelation;
        });

        const relatedCollection = computed(() => {
            return relationInfo.value?.related_collection;
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

        const selectedItem = computed(() => {
            return props.value;
        });

        const selectedItemData = computed(() => {
            if (!selectedItem.value) return null;
            return items.value.find(
                (item) => item[relatedPrimaryKey.value] === selectedItem.value,
            );
        });

        const fetchItems = async (search = "") => {
            if (!relatedCollection.value) return;

            loading.value = true;

            try {
                const params = {
                    limit: 100,
                    fields: ["*"],
                };

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

        const onSearchInput = debounce((value) => {
            fetchItems(value);
        }, 300);

        const clearSearch = () => {
            searchQuery.value = "";
            fetchItems();
        };

        const toggleDropdown = () => {
            if (props.disabled) return;
            isOpen.value = !isOpen.value;

            if (isOpen.value) {
                // Clear search when opening
                searchQuery.value = "";
                // Fetch items if list is empty
                if (items.value.length === 0) {
                    fetchItems();
                }
            }
        };

        const closeDropdown = () => {
            isOpen.value = false;
            // Don't clear search query immediately - keep it for better UX
            // searchQuery.value = "";
        };

        const selectItem = (item) => {
            if (props.disabled) return;
            const itemId = item[relatedPrimaryKey.value];

            // Ensure the item is in the items array so it can be displayed
            const exists = items.value.some(
                (i) => i[relatedPrimaryKey.value] === itemId,
            );
            if (!exists) {
                items.value.unshift(item);
            }

            emit("input", itemId);
            closeDropdown();
        };

        const clearSelection = () => {
            emit("input", null);
        };

        const createNew = () => {
            newItem.value = {};
            drawerOpen.value = true;
        };

        const saveNewItem = async () => {
            saving.value = true;

            try {
                const response = await api.post(
                    `/items/${relatedCollection.value}`,
                    newItem.value,
                );
                const created = response.data.data;

                items.value.unshift(created);

                if (relatedPrimaryKey.value) {
                    emit("input", created[relatedPrimaryKey.value]);
                }

                drawerOpen.value = false;
                newItem.value = {};
                closeDropdown();
            } catch (error) {
                console.error("Error saving new item:", error);
            } finally {
                saving.value = false;
            }
        };

        // Close dropdown when clicking outside
        const handleClickOutside = (event) => {
            const dropdown = event.target.closest(".m2o-dropdown");
            if (!dropdown && isOpen.value) {
                closeDropdown();
            }
        };

        onMounted(() => {
            document.addEventListener("click", handleClickOutside);
        });

        onUnmounted(() => {
            document.removeEventListener("click", handleClickOutside);
        });

        // Fetch selected item if not in list
        watch(
            () => props.value,
            async (newValue) => {
                if (
                    !newValue ||
                    !relatedCollection.value ||
                    !relatedPrimaryKey.value
                )
                    return;

                const exists = items.value.some(
                    (item) => item[relatedPrimaryKey.value] === newValue,
                );

                if (!exists) {
                    try {
                        const response = await api.get(
                            `/items/${relatedCollection.value}/${newValue}`,
                            {
                                params: {
                                    fields: ["*"],
                                },
                            },
                        );

                        if (response.data.data) {
                            items.value.unshift(response.data.data);
                        }
                    } catch (error) {
                        console.error("Error fetching selected item:", error);
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
            selectedItem,
            selectedItemData,
            searchQuery,
            isOpen,
            onSearchInput,
            clearSearch,
            toggleDropdown,
            closeDropdown,
            selectItem,
            clearSelection,
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
.m2o-dropdown {
    position: relative;
}

.dropdown-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px;
    background-color: var(--theme--background);
    border: var(--theme--border-width) solid
        var(--theme--form--field--input--border-color);
    border-radius: var(--theme--border-radius);
    cursor: pointer;
    transition: border-color var(--fast) var(--transition);
    min-height: 44px;
}

.dropdown-trigger:hover:not(.disabled) {
    border-color: var(--theme--form--field--input--border-color-hover);
}

.dropdown-trigger.open {
    border-color: var(--theme--primary);
}

.dropdown-trigger.disabled {
    cursor: not-allowed;
    opacity: 0.5;
    background-color: var(--theme--background-subdued);
}

.selected-value {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.placeholder {
    flex: 1;
    color: var(--theme--foreground-subdued);
}

.dropdown-icons {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 8px;
}

.dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background-color: var(--theme--background);
    border: var(--theme--border-width) solid
        var(--theme--form--field--input--border-color);
    border-radius: var(--theme--border-radius);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    z-index: 100;
    max-height: 400px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
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
    padding: 10px 12px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
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
    color: var(--theme--primary);
}

.check-icon {
    color: var(--theme--primary);
}

.no-results {
    padding: 20px;
    text-align: center;
    color: var(--theme--foreground-subdued);
}

.add-new {
    width: 100%;
}

.drawer-content {
    padding: var(--content-padding);
    padding-top: 0;
    padding-bottom: var(--content-padding-bottom);
}
</style>
