import { defineInterface } from '@directus/extensions-sdk';
import InterfaceComponent from './interface.vue';

export default defineInterface({
    id: 'o2m-dropdown',
    name: 'O2M Dropdown',
    description: 'A searchable dropdown for One-to-Many relationships',
    icon: 'arrow_drop_down',
    component: InterfaceComponent,
    types: ['alias'],
    localTypes: ['o2m'],
    group: 'relational',
    options: ({ relations }) => {
        const relation = relations.o2m;

        return [
            {
                field: 'template',
                name: '$t:display_template',
                meta: {
                    interface: 'system-display-template',
                    options: {
                        collectionName: relation?.collection,
                    },
                    width: 'full',
                },
            },
            {
                field: 'enableCreate',
                name: 'Enable Create',
                type: 'boolean',
                meta: {
                    interface: 'boolean',
                    options: {
                        label: 'Allow creating new items',
                    },
                    width: 'half',
                },
                schema: {
                    default_value: false,
                },
            },
            {
                field: 'filter',
                name: '$t:filter',
                type: 'json',
                meta: {
                    interface: 'system-filter',
                    options: {
                        collectionName: relation?.collection,
                    },
                    width: 'full',
                },
            },
        ];
    },
    recommendedDisplays: ['related-values'],
});