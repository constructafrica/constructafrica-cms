import { defineInterface } from "@directus/extensions-sdk";
import InterfaceComponent from "./interface.vue";

export default defineInterface({
  id: "junction-dropdown",
  name: "Junction M2M Dropdown",
  description:
    "Searchable dropdown for Many-to-Many relationships via junction table",
  icon: "link",
  component: InterfaceComponent,
  types: ["alias"],
  localTypes: ["m2m"],
  group: "relational",
  options: ({ relations }) => {
    // For M2M, we need to find the related collection through the junction
    let relatedCollection = null;

    // Try different approaches to find the related collection
    if (relations?.m2m) {
      // Approach 1: Check if m2m has the one_collection_field or one_allowed_collections
      if (relations.m2m.meta?.one_collection_field) {
        // This is a polymorphic relationship
        relatedCollection = null; // Can't determine for polymorphic
      } else if (relations.m2m.meta?.one_allowed_collections) {
        // Use the first allowed collection
        relatedCollection = relations.m2m.meta.one_allowed_collections[0];
      } else {
        // Standard M2M - need to find the "other side" relation
        const junctionCollection = relations.m2m.related_collection;

        // The junction table has two M2O relations:
        // 1. One back to our collection (we skip this)
        // 2. One to the related collection (we want this)

        // Check if there's a one_field that tells us which field in junction points to related
        if (relations.m2m.meta?.one_field) {
          // We need to look at all relations to find where this field connects
          // Since we don't have access to all relations here, we'll pass null
          // and let the component figure it out
          relatedCollection = null;
        }
      }
    }

    // Fallback: try to extract from relations object structure
    if (!relatedCollection && relations?.o2m) {
      // Sometimes the related collection info is in o2m
      const o2mRelations = Array.isArray(relations.o2m)
        ? relations.o2m
        : [relations.o2m];

      // Find a relation that's not our current collection
      for (const rel of o2mRelations) {
        if (
          rel?.related_collection &&
          rel.collection !== relations.m2m?.collection
        ) {
          relatedCollection = rel.related_collection;
          break;
        }
      }
    }

    return [
      {
        field: "template",
        name: "$t:display_template",
        meta: {
          interface: "system-display-template",
          options: {
            collectionName: relatedCollection,
          },
          width: "full",
        },
      },
      {
        field: "enableCreate",
        name: "Enable Create",
        type: "boolean",
        meta: {
          interface: "boolean",
          options: {
            label: "Allow creating new items in related collection",
          },
          width: "half",
        },
        schema: {
          default_value: false,
        },
      },
      {
        field: "filter",
        name: "$t:filter",
        type: "json",
        meta: {
          interface: "system-filter",
          options: {
            collectionName: relatedCollection,
          },
          width: "full",
        },
      },
    ];
  },
  recommendedDisplays: ["related-values"],
});
