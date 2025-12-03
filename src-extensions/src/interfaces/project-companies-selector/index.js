import InterfaceComponent from './interface.vue';

export default {
    id: 'project-companies-selector',
    name: 'Project Companies Selector',
    description: 'Select companies with roles in a user-friendly interface',
    icon: 'business',
    component: InterfaceComponent,
    options: null,
    types: ['alias'],
    localTypes: ['o2m'],
    group: 'relational',
    relational: true,
};