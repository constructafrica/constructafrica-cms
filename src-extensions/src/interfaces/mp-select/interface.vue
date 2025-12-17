<template>
  <v-notice v-if="!relationInfo" type="warning">
    {{ t('relationship_not_setup') }}
  </v-notice>
  <div v-else class="o2m-dropdown">
    <v-select
        :model-value="selectedItems"
        :items="items"
        :loading="loading"
        :multiple="true"
        :placeholder="t('search_items')"
        :disabled="disabled"
        :show-deselect="true"
        @update:model-value="updateValue"
        @search="onSearch"
    >
      <template #item="{ item }">
        <v-list-item-content>
          <render-template
              :collection="relationInfo.relatedCollection.collection"
              :item="item"
              :template="template"
          />
        </v-list-item-content>
      </template>

      <template #selection="{ item }">
        <v-chip small close @click:close="removeItem(item.value)">
          <render-template
              :collection="relationInfo.relatedCollection.collection"
              :item="item"
              :template="template"
          />
        </v-chip>
      </template>
    </v-select>

    <v-button
        v-if="enableCreate"
        small
        class="add-new"
        :disabled="disabled"
        @click="createNew"
    >
      <v-icon name="add" small />
      {{ t('create_new') }}
    </v-button>

    <v-drawer
        v-model="drawerOpen"
        :title="t('create_item')"
        persistent
        @cancel="drawerOpen = false"
    >
      <template #actions>
        <v-button secondary @click="drawerOpen = false">
          {{ t('cancel') }}
        </v-button>
        <v-button :loading="saving" @click="saveNewItem">
          {{ t('save') }}
        </v-button>
      </template>

      <div class="drawer-content">
        <v-form
            v-model="newItem"
            :collection="relationInfo.relatedCollection.collection"
            :primary-key="'+'"
            :loading="false"
            :disabled="false"
        />
      </div>
    </v-drawer>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useApi, useStores } from '@directus/extensions-sdk';
import { useRelationO2M } from '@directus/composables';
import { debounce } from 'lodash';

export default defineComponent({
  props: {
    value: {
      type: Array,
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
  emits: ['input'],
  setup(props, { emit }) {
    const { t } = useI18n();
    const api = useApi();
    const { useRelationsStore, useFieldsStore } = useStores();
    const relationsStore = useRelationsStore();
    const fieldsStore = useFieldsStore();

    const items = ref<any[]>([]);
    const loading = ref(false);
    const searchQuery = ref('');
    const drawerOpen = ref(false);
    const newItem = ref<Record<string, any>>({});
    const saving = ref(false);

    // Get relation info
    const relationInfo = computed(() => {
      const relations = relationsStore.getRelationsForField(props.collection, props.field);
      return useRelationO2M(relations);
    });

    // Get the related collection
    const relatedCollection = computed(() => {
      return relationInfo.value?.relatedCollection.collection;
    });

    // Get the foreign key field
    const foreignKeyField = computed(() => {
      return relationInfo.value?.reverseJunctionField?.field;
    });

    // Get display template
    const displayTemplate = computed(() => {
      if (props.template) return props.template;

      // Get primary field as fallback
      const primaryField = fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection.value);
      return `{{ ${primaryField} }}`;
    });

    // Selected items (the value)
    const selectedItems = computed(() => {
      if (!props.value || !Array.isArray(props.value)) return [];

      return props.value.map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          const primaryKeyField = fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection.value);
          return item[primaryKeyField];
        }
        return item;
      });
    });

    // Fetch items from the API
    const fetchItems = async (search = '') => {
      if (!relatedCollection.value) return;

      loading.value = true;

      try {
        const params: any = {
          limit: 100,
          fields: ['*'],
        };

        // Add search filter
        if (search) {
          const searchableFields = fieldsStore
              .getFieldsForCollection(relatedCollection.value)
              .filter((field: any) =>
                  ['string', 'text'].includes(field.type) &&
                  !field.meta?.hidden
              )
              .map((field: any) => field.field);

          if (searchableFields.length > 0) {
            params.filter = {
              _or: searchableFields.map((field: string) => ({
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

        const response = await api.get(`/items/${relatedCollection.value}`, { params });
        items.value = response.data.data || [];
      } catch (error) {
        console.error('Error fetching items:', error);
        items.value = [];
      } finally {
        loading.value = false;
      }
    };

    // Debounced search
    const onSearch = debounce((search: string) => {
      searchQuery.value = search;
      fetchItems(search);
    }, 300);

    // Update value
    const updateValue = (newValue: any[]) => {
      if (!newValue || newValue.length === 0) {
        emit('input', null);
        return;
      }

      // Transform to the format Directus expects
      const transformedValue = newValue.map((id: any) => {
        // Find the full item data
        const fullItem = items.value.find((item) => {
          const primaryKeyField = fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection.value);
          return item[primaryKeyField] === id;
        });

        // Return the relationship object
        if (fullItem && foreignKeyField.value) {
          return {
            [foreignKeyField.value]: props.primaryKey,
            ...fullItem,
          };
        }

        // Fallback: just return the ID
        return { id };
      });

      emit('input', transformedValue);
    };

    // Remove item
    const removeItem = (id: any) => {
      const newValue = selectedItems.value.filter((itemId) => itemId !== id);
      updateValue(newValue);
    };

    // Create new item
    const createNew = () => {
      newItem.value = {};
      if (foreignKeyField.value) {
        newItem.value[foreignKeyField.value] = props.primaryKey;
      }
      drawerOpen.value = true;
    };

    // Save new item
    const saveNewItem = async () => {
      if (!relatedCollection.value) return;

      saving.value = true;

      try {
        const response = await api.post(`/items/${relatedCollection.value}`, newItem.value);
        const createdItem = response.data.data;

        // Add to items list
        items.value.unshift(createdItem);

        // Add to selected items
        const primaryKeyField = fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection.value);
        const newId = createdItem[primaryKeyField];
        updateValue([...selectedItems.value, newId]);

        // Close drawer
        drawerOpen.value = false;
        newItem.value = {};
      } catch (error) {
        console.error('Error creating item:', error);
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
        { immediate: true }
    );

    // Fetch selected items if they're not in the list
    watch(
        () => props.value,
        async (newValue) => {
          if (!newValue || !Array.isArray(newValue) || newValue.length === 0) return;

          const primaryKeyField = fieldsStore.getPrimaryKeyFieldForCollection(relatedCollection.value);
          const selectedIds = newValue
              .map((item: any) => {
                if (typeof item === 'object' && item !== null) {
                  return item[primaryKeyField];
                }
                return item;
              })
              .filter(Boolean);

          // Check if we need to fetch any items
          const missingIds = selectedIds.filter((id: any) => {
            return !items.value.some((item) => item[primaryKeyField] === id);
          });

          if (missingIds.length > 0) {
            try {
              const response = await api.get(`/items/${relatedCollection.value}`, {
                params: {
                  filter: {
                    [primaryKeyField]: {
                      _in: missingIds,
                    },
                  },
                  fields: ['*'],
                },
              });

              const fetchedItems = response.data.data || [];

              // Add to items list without duplicates
              fetchedItems.forEach((fetchedItem: any) => {
                const exists = items.value.some(
                    (item) => item[primaryKeyField] === fetchedItem[primaryKeyField]
                );
                if (!exists) {
                  items.value.push(fetchedItem);
                }
              });
            } catch (error) {
              console.error('Error fetching selected items:', error);
            }
          }
        },
        { immediate: true }
    );

    return {
      t,
      relationInfo,
      items,
      loading,
      selectedItems,
      onSearch,
      updateValue,
      removeItem,
      displayTemplate,
      template: displayTemplate,
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
.o2m-dropdown {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.add-new {
  align-self: flex-start;
  margin-top: 8px;
}

.drawer-content {
  padding: var(--content-padding);
  padding-top: 0;
  padding-bottom: var(--content-padding-bottom);
}

:deep(.v-chip) {
  margin: 2px;
}
</style>