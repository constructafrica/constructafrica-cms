<template>
  <v-notice v-if="!relationInfo" type="warning">
    {{ t("relationship_not_setup") }}
  </v-notice>
  <div v-else class="m2m-dropdown" v-click-outside="closeList">
    <v-input
        v-model="searchQuery"
        :placeholder="t('search_items')"
        :disabled="disabled"
        @update:model-value="onSearchInput"
        @focus="openList"
        @click="openList"
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
    <div v-if="listOpen" class="dropdown-container">
      <div v-if="loading" class="loading-container">
        <v-progress-circular indeterminate small />
      </div>
      <div v-else-if="availableItems.length > 0" class="items-list">
        <div
            v-for="item in availableItems"
            :key="item[relatedPrimaryKeyFieldName]"
            class="item"
            :class="{
                        selected: isSelected(item[relatedPrimaryKeyFieldName]),
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
import { defineComponent, ref, computed, watch, onMounted } from "vue";
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
    const listOpen = ref(false);

    const relationInfo = computed(() => {
      const fieldRelations = relationsStore.getRelationsForField(
          props.collection,
          props.field,
      );

      if (!fieldRelations || fieldRelations.length === 0) {
        return null;
      }

      const junctionO2MRelation = fieldRelations.find(
          (rel) =>
              rel.related_collection === props.collection &&
              rel.collection !== props.collection,
      );

      if (!junctionO2MRelation) {
        return null;
      }

      const junctionCollection = junctionO2MRelation.collection;

      const otherRelationInJunction = fieldRelations.find(
          (rel) =>
              rel.collection === junctionCollection &&
              rel.related_collection !== props.collection,
      );

      if (!otherRelationInJunction) {
        return null;
      }

      return {
        junctionCollection,
        relatedCollection: otherRelationInJunction.related_collection,
        relatedField: otherRelationInJunction.field,
      };
    });

    const relatedCollection = computed(() => {
      return relationInfo.value?.relatedCollection;
    });

    const junctionCollection = computed(() => {
      return relationInfo.value?.junctionCollection;
    });

    const relatedPrimaryKeyFieldName = computed(() => {
      if (!relatedCollection.value) return "id";
      const pkField = fieldsStore.getPrimaryKeyFieldForCollection(
          relatedCollection.value,
      );
      return pkField?.field || "id";
    });

    const displayTemplate = computed(() => {
      if (props.template) return props.template;
      const fields = fieldsStore.getFieldsForCollection(
          relatedCollection.value,
      );
      const hasName = fields.some((f) => f.field === "name");
      return hasName
          ? "{{ name }}"
          : `{{ ${relatedPrimaryKeyFieldName.value} }}`;
    });

    const selectedItemIds = computed(() => {
      if (!props.value || !Array.isArray(props.value)) return [];
      const relatedField = relationInfo.value?.relatedField;
      if (!relatedField) return [];

      const ids = props.value
          .map((item) => {
            if (!item) return null;
            if (typeof item === "object") {
              const related = item[relatedField];
              if (!related) return null;
              if (typeof related === "object" && related !== null) {
                return related[relatedPrimaryKeyFieldName.value];
              }
              return related;
            }
            return item;
          })
          .filter((id) => id !== null && id !== undefined);

      return ids;
    });

    const selectedItemsData = computed(() => {
      return items.value.filter((item) =>
          selectedItemIds.value.includes(
              item[relatedPrimaryKeyFieldName.value],
          ),
      );
    });

    const availableItems = computed(() => {
      return items.value;
    });

    const isSelected = (itemId) => {
      return selectedItemIds.value.includes(itemId);
    };

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

    const openList = () => {
      if (!disabled) {
        listOpen.value = true;
      }
    };

    const closeList = () => {
      listOpen.value = false;
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
        return;
      }

      const value = selectedIds.map((id) => {
        const existingJunction = props.value?.find((item) => {
          if (!item || typeof item !== "object") return false;
          const related = item[relatedField];
          if (typeof related === "object" && related !== null) {
            return related[relatedPrimaryKeyFieldName.value] === id;
          }
          return related === id;
        });

        if (existingJunction) {
          return existingJunction;
        }

        return {
          [relatedField]: { [relatedPrimaryKeyFieldName.value]: id },
        };
      });

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
        items.value.unshift(created);
        const createdId = created[relatedPrimaryKeyFieldName.value];
        updateValue([...selectedItemIds.value, createdId]);
        drawerOpen.value = false;
        newItem.value = {};
      } catch (error) {
        console.error("Error saving new item:", error);
      } finally {
        saving.value = false;
      }
    };

    // Load items on mount and when collection changes
    onMounted(() => {
      fetchItems();
    });

    watch(
        () => props.collection,
        () => {
          fetchItems();
        },
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
              !relatedPrimaryKeyFieldName.value
          )
            return;

          const missingIds = selectedItemIds.value.filter((id) => {
            return !items.value.some(
                (item) => item[relatedPrimaryKeyFieldName.value] === id,
            );
          });

          if (missingIds.length > 0) {
            try {
              const response = await api.get(
                  `/items/${relatedCollection.value}`,
                  {
                    params: {
                      filter: {
                        [relatedPrimaryKeyFieldName.value]: {
                          _in: missingIds,
                        },
                      },
                      fields: ["*"],
                    },
                  },
              );
              const fetchedItems = response.data.data || [];
              fetchedItems.forEach((fetchedItem) => {
                const exists = items.value.some(
                    (item) =>
                        item[relatedPrimaryKeyFieldName.value] ===
                        fetchedItem[
                            relatedPrimaryKeyFieldName.value
                            ],
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
      openList,
      closeList,
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
    };
  },
  directives: {
    "click-outside": {
      beforeMount(el, binding) {
        el.clickOutsideEvent = (event) => {
          if (!(el === event.target || el.contains(event.target))) {
            binding.value();
          }
        };
        document.addEventListener("click", el.clickOutsideEvent);
      },
      unmounted(el) {
        document.removeEventListener("click", el.clickOutsideEvent);
      },
    },
  },
});
</script>

<style scoped>
.m2m-dropdown {
  display: flex;
  flex-direction: column;
  gap: 12px;
  position: relative;
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

.dropdown-container {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 100;
  background-color: var(--theme--background);
  border: var(--theme--border-width) solid var(--theme--form--field--input--border-color);
  border-radius: var(--theme--border-radius);
  margin-top: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.loading-container {
  display: flex;
  justify-content: center;
  padding: 20px;
}

.items-list {
  max-height: 300px;
  overflow-y: auto;
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
  margin: 8px;
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