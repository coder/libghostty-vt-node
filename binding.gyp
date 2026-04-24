{
  "targets": [
    {
      "target_name": "libghostty_vt_node",
      "sources": [
        "native/addon.cc",
        "native/libghostty_vt_shim.cc",
        "native/terminal.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<!(node scripts/resolve-libghostty-vt.mjs include)"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_VERSION=8",
        "NAPI_CPP_EXCEPTIONS",
        "GHOSTTY_STATIC"
      ],
      "libraries": [
        "<!(node scripts/resolve-libghostty-vt.mjs library)"
      ],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "OTHER_CPLUSPLUSFLAGS": [
                "-std=c++17",
                "-fexceptions"
              ]
            }
          }
        ],
        [
          "OS!='mac'",
          {
            "cflags_cc": [
              "-std=c++17",
              "-fexceptions"
            ]
          }
        ]
      ]
    }
  ]
}
