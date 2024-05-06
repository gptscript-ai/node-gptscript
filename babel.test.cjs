module.exports = {
    "presets": [
        "@babel/preset-typescript",
        [
            "@babel/preset-env",
            {
                "useBuiltIns": "entry",
                "corejs": 3,
                "targets": {
                    "node": "current"
                }
            }
        ]
    ],
    "plugins": [
        "babel-plugin-transform-import-meta"
    ]
};