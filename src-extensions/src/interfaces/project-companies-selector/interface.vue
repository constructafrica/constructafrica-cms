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

      <!-- Company Dropdown with Search -->
      <v-select
          v-model="item.company_id"
          :items="companyOptions"
          item-title="text"
          item-value="value"
          :placeholder="t('search_or_create_company')"
          :show-deselect="false"
          :allow-other="true"
          :loading="loadingCompanies"
          class="company-select"
          @update:modelValue="handleCompanyChange(index, $event)"
          @search="searchCompanies"
      >
        <template #prepend>
          <v-icon name="business" small />
        </template>
      </v-select>

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
import { ref, watch, onMounted } from 'vue';
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
    const companyOptions = ref([]);
    const showCreateDialog = ref(false);
    const creating = ref(false);
    const loadingRoles = ref(false);
    const loadingCompanies = ref(false);
    const pendingCompanyIndex = ref(null);
    let searchTimeout = null;

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

    // Load existing project companies when editing
    const loadExistingData = async () => {
      if (!props.primaryKey) return;

      try {
        const response = await api.get('/items/project_companies', {
          params: {
            filter: {
              project_id: { _eq: props.primaryKey }
            },
            fields: ['id', 'role_id', 'company_id.id', 'company_id.name'],
            limit: -1,
          },
        });

        if (response.data.data.length > 0) {
          internalValue.value = response.data.data.map(item => ({
            id: item.id,
            role_id: item.role_id,
            company_id: typeof item.company_id === 'object' ? item.company_id.id : item.company_id,
          }));

          // Load the companies that are already selected
          const selectedCompanyIds = response.data.data
              .map(item => typeof item.company_id === 'object' ? item.company_id.id : item.company_id)
              .filter(Boolean);

          if (selectedCompanyIds.length > 0) {
            await loadSelectedCompanies(selectedCompanyIds);
          }
        }
      } catch (error) {
        console.error('Error loading existing data:', error);
      }
    };

    // Load specific companies by IDs (for pre-selected values)
    const loadSelectedCompanies = async (companyIds) => {
      try {
        const response = await api.get('/items/companies', {
          params: {
            filter: {
              id: { _in: companyIds }
            },
            fields: ['id', 'name', 'email'],
            limit: -1,
          },
        });

        const selectedCompanies = response.data.data.map(company => ({
          text: company.name,
          value: company.id,
          company: company,
        }));

        // Merge with existing options, avoiding duplicates
        const existingIds = new Set(companyOptions.value.map(c => c.value));
        selectedCompanies.forEach(company => {
          if (!existingIds.has(company.value)) {
            companyOptions.value.push(company);
          }
        });
      } catch (error) {
        console.error('Error loading selected companies:', error);
      }
    };

    // Search companies with debouncing
    const searchCompanies = async (searchQuery) => {
      // Clear existing timeout
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }

      // Debounce search
      searchTimeout = setTimeout(async () => {
        loadingCompanies.value = true;
        try {
          const filter = searchQuery
              ? { name: { _icontains: searchQuery } }
              : {};

          const response = await api.get('/items/companies', {
            params: {
              fields: ['id', 'name', 'email'],
              limit: 50,
              filter,
              sort: ['name'],
            },
          });

          companyOptions.value = response.data.data.map(company => ({
            text: company.name,
            value: company.id,
            company: company,
          }));
        } catch (error) {
          console.error('Error searching companies:', error);
        } finally {
          loadingCompanies.value = false;
        }
      }, 300);
    };

    // Initialize - load roles and check for existing data
    onMounted(async () => {
      await loadRoles();
      await loadExistingData();
      // Load initial companies
      await searchCompanies('');
    });

    // Watch for changes to value prop (in case it updates externally)
    watch(
        () => props.value,
        (newVal) => {
          if (newVal && Array.isArray(newVal) && newVal.length > 0) {
            // Only update if we don't already have data loaded
            if (internalValue.value.length === 0) {
              internalValue.value = newVal.map(item => ({
                id: item.id || null,
                role_id: item.role_id || null,
                company_id: typeof item.company_id === 'object'
                    ? item.company_id?.id
                    : item.company_id,
              }));
            }
          }
        }
    );

    // Add new item
    const addItem = () => {
      internalValue.value.push({
        id: null,
        role_id: null,
        company_id: null,
      });
      updateValue();
    };

    // Remove item
    const removeItem = (index) => {
      internalValue.value.splice(index, 1);
      updateValue();
    };

    // Handle company change (check if it's a new company)
    const handleCompanyChange = (index, value) => {
      // Check if this is a string (new company name) or an ID
      if (typeof value === 'string' && !companyOptions.value.find(c => c.value === value)) {
        // User entered a new company name
        pendingCompanyIndex.value = index;
        newCompany.value.name = value;
        showCreateDialog.value = true;
      } else {
        internalValue.value[index].company_id = value;
        updateValue();
      }
    };

    // Create new company
    const createCompany = async () => {
      if (!newCompany.value.name) return;

      creating.value = true;
      try {
        const response = await api.post('/items/companies', newCompany.value);
        const createdCompany = response.data.data;

        // Add to options
        companyOptions.value.unshift({
          text: createdCompany.name,
          value: createdCompany.id,
          company: createdCompany,
        });

        // Set the new company ID
        if (pendingCompanyIndex.value !== null) {
          internalValue.value[pendingCompanyIndex.value].company_id = createdCompany.id;
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
      const filtered = internalValue.value.filter(
          item => item.role_id && item.company_id
      );
      emit('input', filtered);
    };

    return {
      t,
      internalValue,
      roleOptions,
      companyOptions,
      showCreateDialog,
      creating,
      loadingRoles,
      loadingCompanies,
      newCompany,
      addItem,
      removeItem,
      handleCompanyChange,
      createCompany,
      searchCompanies,
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
  align-items: center;
  margin-bottom: 12px;
  padding: 12px;
  background-color: var(--theme--background);
  border-radius: var(--theme--border-radius);
  border: 2px solid var(--theme--border-color-subdued);
}

.role-select,
.company-select {
  width: 100%;
}

.remove-btn {
  color: var(--theme--danger);
  cursor: pointer;
  transition: transform 0.2s;
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
  }

  .field.half {
    grid-column: 1 / -1;
  }
}
</style>