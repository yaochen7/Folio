const paths={
 link:'<path d="m10 13 4-4m-7 6-1 1a4 4 0 0 0 6 6l3-3a4 4 0 0 0 0-6m2-4 1-1a4 4 0 0 0-6-6L9 5a4 4 0 0 0 0 6"/>',
 upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 list:'<path d="M4 5h16M4 10h16M4 15h10"/><circle cx="5" cy="20" r=".8"/><circle cx="10" cy="20" r=".8"/><circle cx="15" cy="20" r=".8"/>',
 more:'<g fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2.3"/><circle cx="12" cy="12" r="2.3"/><circle cx="19" cy="12" r="2.3"/></g>',
 compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5L16 8Z"/>',
 grid:'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
 library:'<path d="M4 4v16M9 4v16M14 4v16m3-15 4 14"/>',

 'book-open':'<path d="M12 7c-3-2-6-2-10-1v14c4-1 7-1 10 1 3-2 6-2 10-1V6c-4-1-7-1-10 1Z"/><path d="M12 7v14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
 menu:'<path d="M4 8h16M4 16h16"/>',
 rows:'<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="2.6"/>',
 sort:'<path d="M7 4v16m-3-3 3 3 3-3M17 20V4m-3 3 3-3 3 3"/>',
 x:'<path d="m6 6 12 12M18 6 6 18"/>',
 bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
 'chevron-right':'<path d="m9 5 7 7-7 7"/>',
 'chevron-left':'<path d="m15 5-7 7 7 7"/>',
 'chevron-down':'<path d="m5 9 7 7 7-7"/>',
 'arrow-right':'<path d="M4 12h16m-6-6 6 6-6 6"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 'credit-card':'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h3"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 'log-out':'<path d="M9 3H4v18h5m6-16 7 7-7 7m-7-7h14"/>',
 cloud:'<path d="M7 18a5 5 0 1 1 .3-10 6 6 0 0 1 11.5 1.6A4.2 4.2 0 0 1 18 18H7Z"/>',
 'arrow-up-right':'<path d="M6 18 18 6M7 6h11v11"/>'
};
export function icon(name){return `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths['book-open']}</svg>`;}
export function hydrateIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);el.removeAttribute('data-icon');});}
