{
  "targets": [
    {
      "target_name": "service_status",
      "sources": ["src/service_status.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["-ladvapi32"]
        }]
      ]
    }
  ]
}
