<template>
  <v-notice v-if="!relationInfo" type="warning">
    {{ t("relationship_not_setup") }}
  </v-notice>
  <div v-else v-click-outside="closeDropdown" class="m2o-dropdown">
    <div
        class="dropdown-toggle"
        :class="{ disabled: disabled, open: dropdownOpen }"
        @click="toggleDropdown"
    >
      <div class="selected-value">
        <render-template
            v-if="selectedItemData"
            :collection="relatedCollection"
            :item="selectedItemData"
            :template="displayTemplate"
        />
        <span v-else class="placeholder">
                    {{ t("select_an_item") }}
                </span>
      </div>
      <v-icon :name="dropdownOpen ? 'expand_less' : 'expand_more'" />
    </div>

    <div v-if="dropdownOpen" class="dropdown-content">
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
              @click="clearSearch"
          />
        </template>
      </v-input>

      <div v-if="loading" class="loading-container">
        <v-progress-circular indeterminate />
      </div>

      <div v-else-if="items.length > 0" class="items-list">
        <div
            v-for="item in items"
            :key="item[relatedPrimaryKey]"
            class="item"
            :class="{ selected: selectedItem === item[relatedPrimaryKey] }"
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
import { defineComponent, ref, computed, watch } from "vue";
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
    const drawerOpen = ref(false);
    const newItem = ref({});
    const saving = ref(false);
    const dropdownOpen = ref(false);
    const selectedItemData = ref(null);

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

    const toggleDropdown = () => {
      if (props.disabled) return;
      dropdownOpen.value = !dropdownOpen.value;
      if (dropdownOpen.value) {
        fetchItems();
      }
    };

    const closeDropdown = () => {
      dropdownOpen.value = false;
      searchQuery.value = "";
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

    const selectItem = (item) => {
      if (props.disabled) return;
      const itemId = item[relatedPrimaryKey.value];
      emit("input", itemId);
      selectedItemData.value = item;
      closeDropdown();
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
          selectedItemData.value = created;
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

    const fetchSelectedItem = async () => {
      if (
          !props.value ||
          !relatedCollection.value ||
          !relatedPrimaryKey.value
      )
        return;

      try {
        const response = await api.get(
            `/items/${relatedCollection.value}/${props.value}`,
            {
              params: {
                fields: ["*"],
              },
            },
        );

        if (response.data.data) {
          selectedItemData.value = response.data.data;
        }
      } catch (error) {
        console.error("Error fetching selected item:", error);
      }
    };

    watch(
        () => props.value,
        async (newValue) => {
          if (!newValue) {
            selectedItemData.value = null;
            return;
          }

          if (
              !relatedCollection.value ||
              !relatedPrimaryKey.value
          )
            return;

          const exists = items.value.find(
              (item) => item[relatedPrimaryKey.value] === newValue,
          );

          if (exists) {
            selectedItemData.value = exists;
          } else {
            await fetchSelectedItem();
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
      onSearchInput,
      clearSearch,
      selectItem,
      displayTemplate,
      relatedCollection,
      relatedPrimaryKey,
      createNew,
      drawerOpen,
      newItem,
      saving,
      saveNewItem,
      dropdownOpen,
      toggleDropdown,
      closeDropdown,
    };
  },
});
</script>

<style scoped>
.m2o-dropdown {
  position: relative;
  width: 100%;
}

.dropdown-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background-color: var(--theme--background);
  border: var(--theme--border-width) solid
  var(--theme--form--field--input--border-color);
  border-radius: var(--theme--border-radius);
  cursor: pointer;
  transition: all var(--fast) var(--transition);
  min-height: 44px;
}

.dropdown-toggle:hover:not(.disabled) {
  border-color: var(--theme--form--field--input--border-color-hover);
}

.dropdown-toggle.open {
  border-color: var(--theme--primary);
}

.dropdown-toggle.disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.selected-value {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.placeholder {
  color: var(--theme--foreground-subdued);
}

.dropdown-content {
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
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  max-height: 400px;
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