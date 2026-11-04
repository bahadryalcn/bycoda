import { expect, it } from "vitest";
import { inspectionNodes } from "./device-inspection";

it("normalizes Android and native geometry while rejecting unusable nodes", () => {
  const xml =
    '<?xml version="1.0"?><hierarchy><node text="Save" content-desc="" class="android.widget.Button" clickable="true" enabled="true" bounds="[10,20][110,70]" /></hierarchy>';
  expect(inspectionNodes(JSON.stringify({ success: true, data: { xml } }))).toEqual([
    {
      id: "0",
      label: "Save",
      role: "android.widget.Button",
      identity: expect.any(String),
      bounds: { x: 10, y: 20, width: 100, height: 50 },
      enabled: true,
      clickable: true,
    },
  ]);
  const raw = JSON.stringify({
    success: true,
    data: {
      nodes: [
        {
          label: "Go",
          type: "Button",
          enabled: true,
          hittable: true,
          rect: { x: 1, y: 2, width: 3, height: 4 },
        },
        { label: "Invalid", rect: { x: -1, y: 0, width: 2, height: 2 } },
      ],
    },
  });
  expect(inspectionNodes(raw)).toHaveLength(1);
  expect(() => inspectionNodes(JSON.stringify({ success: true, data: {} }))).toThrow(
    "DEVICE_INSPECTION_UNSUPPORTED",
  );
});

it("labels an actionable Android container only from its actual nonactionable descendants", () => {
  const xml = `<?xml version="1.0"?><hierarchy>
    <node class="android.widget.LinearLayout" resource-id="settings:search" clickable="true" enabled="true" bounds="[0,0][200,80]">
      <node class="android.widget.TextView" text="Search Settings" clickable="false" enabled="true" bounds="[20,20][180,60]" />
    </node>
    <node class="android.widget.Button" text="Other" clickable="true" enabled="true" bounds="[0,0][200,80]" />
  </hierarchy>`;
  const nodes = inspectionNodes(JSON.stringify({ success: true, data: { xml } }));
  expect(nodes[0]).toMatchObject({ label: "Search Settings", clickable: true });
  expect(nodes[1]).toMatchObject({ label: "Search Settings", clickable: false });
  expect(nodes[2]).toMatchObject({ label: "Other", clickable: true });
  const changed = inspectionNodes(
    JSON.stringify({
      success: true,
      data: { xml: xml.replace("settings:search", "settings:other") },
    }),
  );
  expect(changed[0].identity).not.toBe(nodes[0].identity);
});
