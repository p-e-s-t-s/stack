<template>
  <form method="post" action="/auth/logout">
    <button type="submit" class="mp-logout">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M10 4H4v16h6 M9 12h12 M17 8l4 4-4 4" />
      </svg>
      <span>Log out</span>
    </button>
  </form>
</template>
