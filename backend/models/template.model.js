import mongoose from "mongoose";

const templateSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    userType: {
      type: String,
      enum: ["member", "guest"],
      default: "guest",
    },
    guestId: {
      type: String,
      default: null,
      index: true,
    },
    guestName: {
      type: String,
      default: "Guest User",
    },
    title: { type: String, required: true },
    description: { type: String },
    apps: [{ type: String, required: true }],
    appLaunchers: [
      {
        _id: false,
        id: { type: String },
        label: { type: String },
        path: { type: String, required: true },
        args: [{ type: String }],
        cwd: { type: String },
        mode: {
          type: String,
          enum: ["generic", "vscode"],
          default: "generic",
        },
        folderPath: { type: String },
      },
    ],
    websites: [{ type: String }],
    usageCount: { type: Number, default: 0 },
    schedule: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model("Template", templateSchema);
