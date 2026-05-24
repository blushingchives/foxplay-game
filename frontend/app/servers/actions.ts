"use server";
import { redirect } from "next/navigation";

export async function createPost(formData: FormData) {
  const game = formData.get("game");
  const type = formData.get("type");
  const whitelist = formData.getAll("whitelist"); // always an array
  console.log({ game, type, whitelist });
  // Redirect to the new post
  //   redirect(`/servers`);
}
