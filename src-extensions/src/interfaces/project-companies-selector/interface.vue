<template>
  <div class="project-companies-selector">
    <div
        v-for="(item, index) in internalValue"
        :key="item.id || `new-${index}`"
        class="company-row"
    >
      <!-- Role Dropdown -->
      <v-select
          v-model="item.role_id"
          :items="roleOptions"
          item-title="text"
          item-value="value"
          :placeholder="t('select_role')"
          :loading="loadingRoles"
          class="role-select"
          @update:modelValue="updateValue"
      />

      <!-- Company Search Input with Dropdown -->
      <div class="company-select-wrapper">
        <v-input
            :model-value="searchQueries[index] || ''"
            :placeholder="t('search_or_create_company')"
            @update:model-value="handleSearchInput(index, $event)"
            @focus="handleSearchFocus(index)"
        >
          <template #prepend>
            <v-icon name="business" small />
          </template>
          <template #append>
            <v-icon
                v-if="loadingCompanies && activeSearchIndex === index"
                name="refresh"
                small
                spin
            />
          </template>
        </v-input>

        <!-- Dropdown Results -->
        <div
            v-if="showDropdown[index] && (filteredCompanies[index]?.length > 0 || searchQueries[index]?.length > 0)"
            class="company-dropdown"
        >
          <div
              v-for="company in filteredCompanies[index]"
              :key="company.value"
              class="company-option"
              @click="selectCompany(index, company)"
          >
            <v-icon name="business" small />
            <div class="company-info">
              <div class="company-name">{{ company.text }}</div>
              <div v-if="company.company?.email" class="company-email">
                {{ company.company.email }}
              </div>
            </div>
          </div>

          <!-- Create New Option -->
          <div
              v-if="searchQueries[index] && searchQueries[index].length > 2 && !companyExistsInResults(index)"
              class="company-option create-new"
              @click="handleCreateNew(index)"
          >
            <v-icon name="add_circle" small />
            <div class="company-info">
              <div class="company-name">Create "{{ searchQueries[index] }}"</div>
            </div>
          </div>

          <div
              v-if="!loadingCompanies && filteredCompanies[index]?.length === 0 && searchQueries[index]?.length > 0"
              class="no-results"
          >
            No companies found. Type to create new.
          </div>
        </div>
      </div>

      <!-- Remove Button -->
      <v-icon
          name="close"
          clickable
          class="remove-btn"
          @click="removeItem(index)"
      />
    </div>

    <!-- Add New Button -->
    <v-button
        secondary
        small
        @click="addItem"
    >
      <v-icon name="add" small />
      {{ t('add_company') }}
    </v-button>

    <!-- Create Company Dialog -->
    <v-dialog
        v-model="showCreateDialog"
        @esc="showCreateDialog = false"
    >
      <v-card>
        <v-card-title>{{ t('create_new_company') }}</v-card-title>
        <v-card-text>
          <div class="grid">
            <div class="field full">
              <div class="type-label">{{ t('company_name') }}</div>
              <v-input
                  v-model="newCompany.name"
                  :placeholder="t('enter_company_name')"
                  autofocus
              />
            </div>
            <div class="field half">
              <div class="type-label">{{ t('email') }}</div>
              <v-input
                  v-model="newCompany.email"
                  type="email"
                  :placeholder="t('enter_email')"
              />
            </div>
            <div class="field half">
              <div class="type-label">{{ t('phone') }}</div>
              <v-input
                  v-model="newCompany.phone"
                  :placeholder="t('enter_phone')"
              />
            </div>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-button secondary @click="showCreateDialog = false">
            {{ t('cancel') }}
          </v-button>
          <v-button
              :loading="creating"
              :disabled="!newCompany.name"
              @click="createCompany"
          >
            {{ t('create') }}
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script>
import { useApi } from '@directus/extensions-sdk';
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

export default {
  props: {
    value: {
      type: Array,
      default: () => [],
    },
    collection: {
      type: String,
      default: null,
    },
    primaryKey: {
      type: [String, Number],
      default: null,
    },
  },
  emits: ['input'],
  setup(props, { emit }) {
    const api = useApi();
    const { t } = useI18n();

    const internalValue = ref([]);
    const roleOptions = ref([]);
    const searchQueries = reactive({});
    const filteredCompanies = reactive({});
    const showDropdown = reactive({});
    const selectedCompanyNames = reactive({});
    const showCreateDialog = ref(false);
    const creating = ref(false);
    const loadingRoles = ref(false);
    const loadingCompanies = ref(false);
    const activeSearchIndex = ref(null);
    const pendingCompanyIndex = ref(null);
    const searchTimeouts = {};

    const newCompany = ref({
      name: '',
      email: '',
      phone: '',
    });

    // Load roles from the database
    const loadRoles = async () => {
      loadingRoles.value = true;
      try {
        const response = await api.get('/items/project_company_roles', {
          params: {
            fields: ['id', 'name', 'slug'],
            limit: -1,
            sort: ['name'],
          },
        });

        roleOptions.value = response.data.data.map(role => ({
          text: role.name,
          value: role.id,
        }));
      } catch (error) {
        console.error('Error loading roles:', error);
      } finally {
        loadingRoles.value = false;
      }
    };

    // Search companies in database
    const searchCompaniesInDB = async (index, searchQuery) => {
      if (!searchQuery || searchQuery.length < 2) {
        filteredCompanies[index] = [];
        return;
      }

      activeSearchIndex.value = index;
      loadingCompanies.value = true;

      try {
        // Split search query into individual words
        const words = searchQuery.trim().split(/\s+/).filter(word => word.length > 0);

        // Build OR conditions for each word
        const orConditions = words.map(word => ({
          name: { _icontains: word }
        }));

        const response = await api.get('/items/companies', {
          params: {
            fields: ['id', 'name', 'email'],
            limit: 50,
            filter: {
              _or: orConditions
            },
            sort: ['name'],
          },
        });

        filteredCompanies[index] = response.data.data.map(company => ({
          text: company.name,
          value: company.id,
          company: company,
        }));
      } catch (error) {
        console.error('Error searching companies:', error);
        filteredCompanies[index] = [];
      } finally {
        loadingCompanies.value = false;
        activeSearchIndex.value = null;
      }
    };

    // Handle search input with debouncing
    const handleSearchInput = (index, value) => {
      searchQueries[index] = value;
      showDropdown[index] = true;

      // Clear existing timeout for this index
      if (searchTimeouts[index]) {
        clearTimeout(searchTimeouts[index]);
      }

      // Debounce search
      searchTimeouts[index] = setTimeout(() => {
        searchCompaniesInDB(index, value);
      }, 300);
    };

    // Handle search focus
    const handleSearchFocus = (index) => {
      showDropdown[index] = true;
      if (searchQueries[index] && searchQueries[index].length >= 2) {
        searchCompaniesInDB(index, searchQueries[index]);
      }
    };

    // Select company from dropdown
    const selectCompany = (index, company) => {
      internalValue.value[index].company_id = company.value;
      searchQueries[index] = company.text;
      selectedCompanyNames[index] = company.text;
      showDropdown[index] = false;
      updateValue();
    };

    // Check if company exists in results
    const companyExistsInResults = (index) => {
      const query = searchQueries[index]?.toLowerCase();
      return filteredCompanies[index]?.some(
          c => c.text.toLowerCase() === query
      );
    };

    // Handle create new company
    const handleCreateNew = (index) => {
      pendingCompanyIndex.value = index;
      newCompany.value.name = searchQueries[index];
      showDropdown[index] = false;
      showCreateDialog.value = true;
    };

    // Load existing project companies when editing
    const loadExistingData = async () => {
      // Check if primaryKey is valid (not "+" and not null/undefined)
      if (!props.primaryKey || props.primaryKey === '+') {
        console.log('New item or invalid primaryKey, adding empty row');
        if (internalValue.value.length === 0) {
          addItem();
        }
        return;
      }

      try {
        console.log('Loading existing data for project:', props.primaryKey);
        const response = await api.get('/items/project_companies', {
          params: {
            filter: {
              project_id: { _eq: props.primaryKey }
            },
            fields: ['id', 'role_id', 'company_id.id', 'company_id.name'],
            limit: -1,
          },
        });

        console.log('Loaded project_companies:', response.data.data);

        if (response.data.data.length > 0) {
          // Clear existing data first
          internalValue.value = [];

          // Map the data and set up display names
          response.data.data.forEach((item, index) => {
            const companyId = typeof item.company_id === 'object' ? item.company_id.id : item.company_id;
            const companyName = typeof item.company_id === 'object' ? item.company_id.name : '';

            internalValue.value.push({
              id: item.id,
              role_id: item.role_id,
              company_id: companyId,
            });

            // Set the display name in the search input
            if (companyName) {
              searchQueries[index] = companyName;
              selectedCompanyNames[index] = companyName;
            }

            // Initialize dropdown state
            filteredCompanies[index] = [];
            showDropdown[index] = false;
          });
        } else {
          addItem();
        }
      } catch (error) {
        console.error('Error loading existing data:', error);
        if (internalValue.value.length === 0) {
          addItem();
        }
      }
    };

    // Initialize
    onMounted(async () => {
      console.log('Component mounted, primaryKey:', props.primaryKey);
      await loadRoles();
      await loadExistingData();
      console.log('After loadExistingData:', {
        internalValue: internalValue.value,
        searchQueries: { ...searchQueries },
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', handleClickOutside);
    });

    onBeforeUnmount(() => {
      document.removeEventListener('click', handleClickOutside);
      // Clear all timeouts
      Object.values(searchTimeouts).forEach(timeout => clearTimeout(timeout));
    });

    // Handle clicks outside dropdown
    const handleClickOutside = (event) => {
      const target = event.target;
      if (!target.closest('.company-select-wrapper')) {
        Object.keys(showDropdown).forEach(key => {
          showDropdown[key] = false;
        });
      }
    };

    // Watch for changes to value prop
    watch(
        () => props.value,
        (newVal) => {
          if (newVal && Array.isArray(newVal) && newVal.length > 0) {
            internalValue.value = newVal.map(item => ({
              id: item.id || null,
              role_id: item.role_id || null,
              company_id: typeof item.company_id === 'object'
                  ? item.company_id?.id
                  : item.company_id,
            }));
          }
        },
        { deep: true }
    );

    // Watch for changes to primaryKey (when navigating between items)
    watch(
        () => props.primaryKey,
        (newKey, oldKey) => {
          console.log('PrimaryKey changed from', oldKey, 'to', newKey);
          // Only reload if the key actually changed and is valid
          if (newKey !== oldKey && newKey && newKey !== '+') {
            // Clear existing data
            internalValue.value = [];
            Object.keys(searchQueries).forEach(key => delete searchQueries[key]);
            Object.keys(filteredCompanies).forEach(key => delete filteredCompanies[key]);
            Object.keys(showDropdown).forEach(key => delete showDropdown[key]);
            Object.keys(selectedCompanyNames).forEach(key => delete selectedCompanyNames[key]);

            // Reload data
            loadExistingData();
          }
        }
    );

    // Add new item
    const addItem = () => {
      const newIndex = internalValue.value.length;
      internalValue.value.push({
        id: null,
        role_id: null,
        company_id: null,
      });
      searchQueries[newIndex] = '';
      filteredCompanies[newIndex] = [];
      showDropdown[newIndex] = false;
      updateValue();
    };

    // Remove item
    const removeItem = (index) => {
      internalValue.value.splice(index, 1);
      delete searchQueries[index];
      delete filteredCompanies[index];
      delete showDropdown[index];
      delete selectedCompanyNames[index];
      updateValue();
    };

    // Create new company
    const createCompany = async () => {
      if (!newCompany.value.name) return;

      creating.value = true;
      try {
        const response = await api.post('/items/companies', newCompany.value);
        const createdCompany = response.data.data;

        // Set the new company
        if (pendingCompanyIndex.value !== null) {
          const index = pendingCompanyIndex.value;
          internalValue.value[index].company_id = createdCompany.id;
          searchQueries[index] = createdCompany.name;
          selectedCompanyNames[index] = createdCompany.name;
          updateValue();
        }

        // Reset and close
        showCreateDialog.value = false;
        newCompany.value = {name: '', email: '', phone: ''};
        pendingCompanyIndex.value = null;
      } catch (error) {
        console.error('Error creating company:', error);
        alert('Failed to create company. Please try again.');
      } finally {
        creating.value = false;
      }
    };

    // Update parent value
    const updateValue = () => {
      const filtered = internalValue.value
          .filter(item => item.role_id && item.company_id)
          .map(item => ({
            id: item.id,
            role_id: item.role_id,
            company_id: item.company_id,
          }));

      emit('input', filtered.length > 0 ? filtered : []);
    };

    return {
      t,
      internalValue,
      roleOptions,
      searchQueries,
      filteredCompanies,
      showDropdown,
      selectedCompanyNames,
      showCreateDialog,
      creating,
      loadingRoles,
      loadingCompanies,
      activeSearchIndex,
      newCompany,
      addItem,
      removeItem,
      handleSearchInput,
      handleSearchFocus,
      selectCompany,
      companyExistsInResults,
      handleCreateNew,
      createCompany,
      updateValue,
    };
  },
};
</script>

<style scoped>
.project-companies-selector {
  padding: 12px;
  background-color: var(--theme--background-subdued);
  border-radius: var(--theme--border-radius);
}

.company-row {
  display: grid;
  grid-template-columns: 200px 1fr 40px;
  gap: 12px;
  align-items: start;
  margin-bottom: 12px;
  padding: 12px;
  background-color: var(--theme--background);
  border-radius: var(--theme--border-radius);
  border: 2px solid var(--theme--border-color-subdued);
}

.role-select {
  width: 100%;
}

.company-select-wrapper {
  position: relative;
  width: 100%;
}

.company-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  margin-top: 4px;
  max-height: 300px;
  overflow-y: auto;
  background-color: var(--theme--background);
  border: 2px solid var(--theme--border-color-subdued);
  border-radius: var(--theme--border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 100;
}

.company-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.company-option:hover {
  background-color: var(--theme--background-subdued);
}

.company-option.create-new {
  border-top: 2px solid var(--theme--border-color-subdued);
  color: var(--theme--primary);
  font-weight: 500;
}

.company-info {
  flex: 1;
  min-width: 0;
}

.company-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.company-email {
  font-size: 12px;
  color: var(--theme--foreground-subdued);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.no-results {
  padding: 12px;
  text-align: center;
  color: var(--theme--foreground-subdued);
  font-size: 14px;
}

.remove-btn {
  color: var(--theme--danger);
  cursor: pointer;
  transition: transform 0.2s;
  margin-top: 8px;
}

.remove-btn:hover {
  transform: scale(1.1);
}

.grid {
  display: grid;
  gap: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field.full {
  grid-column: 1 / -1;
}

.field.half {
  grid-column: span 1;
}

.type-label {
  font-weight: 600;
  font-size: 14px;
  color: var(--theme--foreground);
}

@media (max-width: 768px) {
  .company-row {
    grid-template-columns: 1fr;
  }

  .remove-btn {
    justify-self: end;
    margin-top: 0;
  }

  .field.half {
    grid-column: 1 / -1;
  }
}
</style>