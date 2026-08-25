export function renderVentas( main, ctx ) {
	const { supabase, org, membership } = ctx;
	let variants = [];
	let search = '';
	let cart = []; // { variantId, name, size, color, price, stock, qty }
	let saving = false;
	let errorMsg = '';
	let successMsg = '';
	let sales = [];
	let memberNames = new Map();
	let range = 'mes' === ctx.navParams?.range ? 'mes' : 'hoy';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';
		await Promise.all( [ loadVariants(), loadSales() ] );
		draw();
	}

	async function loadVariants() {
		const { data, error } = await supabase
			.from( 'product_variants' )
			.select( 'id, size, color, price, stock_quantity, products ( name )' )
			.eq( 'organization_id', org.id )
			.gt( 'stock_quantity', 0 )
			.order( 'created_at', { ascending: false } );

		if ( error ) {
			errorMsg = 'No se pudo cargar productos: ' + error.message;
			variants = [];
			return;
		}
		variants = data || [];
	}

	async function loadSales() {
		const cutoff = new Date();
		if ( 'mes' === range ) {
			cutoff.setDate( 1 );
		}
		cutoff.setHours( 0, 0, 0, 0 );

		const [ salesRes, membersRes ] = await Promise.all( [
			supabase
				.from( 'sales' )
				.select( 'id, customer_name, total_amount, created_at, vendor_id, sale_items ( quantity )' )
				.eq( 'organization_id', org.id )
				.gte( 'created_at', cutoff.toISOString() )
				.order( 'created_at', { ascending: false } ),
			supabase.from( 'memberships' ).select( 'user_id, full_name' ).eq( 'organization_id', org.id ),
		] );

		sales = salesRes.data || [];
		memberNames = new Map( ( membersRes.data || [] ).map( ( m ) => [ m.user_id, m.full_name ] ) );
	}

	function draw() {
		const filtered = filterVariants();
		const cartTotal = cart.reduce( ( sum, item ) => sum + item.price * item.qty, 0 );

		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Ventas</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			${ successMsg ? `<div class="acp-error" style="background:oklch(0.72 0.16 152 / 0.12);border-color:oklch(0.72 0.16 152 / 0.35);color:oklch(0.72 0.16 152)">${ esc( successMsg ) }</div>` : '' }

			<div class="acp-ventas-grid">
				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
					<div style="font-size:14px;font-weight:700;margin-bottom:12px">Buscar producto</div>
					<input id="v-search" placeholder="Nombre del producto…" value="${ escAttr( search ) }"
						style="width:100%;background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:11px 14px;color:var(--text);font-size:14px;font-family:inherit;outline:none;margin-bottom:14px" />
					<div style="display:flex;flex-direction:column;gap:6px;max-height:360px;overflow-y:auto">
						${
							0 === filtered.length
								? '<div style="font-size:13px;color:var(--text-muted)">Sin resultados.</div>'
								: filtered.map( variantRowHtml ).join( '' )
						}
					</div>
				</div>

				<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
					<div style="font-size:14px;font-weight:700;margin-bottom:12px">Venta actual</div>
					${
						0 === cart.length
							? '<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Agrega productos de la izquierda.</div>'
							: `<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">${ cart.map( cartRowHtml ).join( '' ) }</div>`
					}
					<div class="acp-field">
						<label>Cliente (opcional)</label>
						<input id="v-customer" placeholder="Nombre del cliente" style="padding:10px 12px" />
					</div>
					<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;margin:14px 0">
						<span>Total</span><span>${ money( cartTotal ) }</span>
					</div>
					<button type="button" class="acp-btn-primary" id="v-submit" ${ saving || 0 === cart.length ? 'disabled' : '' }>
						${ saving ? 'Registrando…' : 'Registrar venta' }
					</button>
				</div>
			</div>

			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
				<div style="font-size:15px;font-weight:700">Ventas</div>
				<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
					<button type="button" class="v-range-btn" data-range="hoy" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'hoy' === range ? 'var(--accent)' : 'transparent' };color:${ 'hoy' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Hoy</button>
					<button type="button" class="v-range-btn" data-range="mes" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'mes' === range ? 'var(--accent)' : 'transparent' };color:${ 'mes' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Este mes</button>
				</div>
			</div>
			${ 0 === sales.length ? '<div class="acp-empty-state">No hay ventas en este rango.</div>' : salesTableHtml() }
		`;

		wireEvents();
	}

	function filterVariants() {
		if ( '' === search.trim() ) return variants;
		const q = search.trim().toLowerCase();
		return variants.filter( ( v ) => v.products.name.toLowerCase().includes( q ) );
	}

	function variantRowHtml( v ) {
		return `
			<div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--border);border-radius:10px">
				<div style="flex:1;min-width:0">
					<div style="font-size:13px;font-weight:600">${ esc( v.products.name ) }</div>
					<div style="font-size:12px;color:var(--text-muted)">${ esc( v.size ) }${ v.color ? ' · ' + esc( v.color ) : '' } · ${ money( v.price ) } · stock ${ v.stock_quantity }</div>
				</div>
				<button type="button" class="acp-btn-secondary" style="width:auto;padding:8px 14px" data-add="${ v.id }">Agregar</button>
			</div>
		`;
	}

	function cartRowHtml( item ) {
		return `
			<div style="display:flex;align-items:center;gap:8px;font-size:13px" data-cart="${ item.variantId }">
				<div style="flex:1;min-width:0">
					<div style="font-weight:600">${ esc( item.name ) }</div>
					<div style="color:var(--text-muted)">${ esc( item.size ) }${ item.color ? ' · ' + esc( item.color ) : '' }</div>
				</div>
				<button type="button" class="c-minus" style="background:var(--btn-secondary-bg);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:6px;cursor:pointer;font-size:16px;flex:0 0 auto">−</button>
				<div style="width:24px;text-align:center">${ item.qty }</div>
				<button type="button" class="c-plus" style="background:var(--btn-secondary-bg);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:6px;cursor:pointer;font-size:16px;flex:0 0 auto">+</button>
				<div style="width:70px;text-align:right;font-weight:700">${ money( item.price * item.qty ) }</div>
				<button type="button" class="c-remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:16px">&times;</button>
			</div>
		`;
	}

	function salesTableHtml() {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
				<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.8fr);gap:12px;padding:12px 18px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
					<div>Fecha</div><div>Vendedor</div><div>Cliente</div><div>Ítems</div><div>Total</div>
				</div>
				${ sales
					.map(
						( s ) => `
					<div style="display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1.2fr) minmax(0,1fr) minmax(0,0.8fr) minmax(0,0.8fr);gap:12px;padding:12px 18px;font-size:13px;border-bottom:1px solid var(--border)">
						<div>${ formatSaleDateTime( s.created_at ) }</div>
						<div>${ esc( memberNames.get( s.vendor_id ) || '—' ) }</div>
						<div style="color:var(--text-muted)">${ esc( s.customer_name || '—' ) }</div>
						<div>${ s.sale_items.reduce( ( n, it ) => n + it.quantity, 0 ) }</div>
						<div style="font-weight:700">${ money( s.total_amount ) }</div>
					</div>
				`
					)
					.join( '' ) }
			</div>
		`;
	}

	function wireEvents() {
		const searchInput = document.getElementById( 'v-search' );
		searchInput.addEventListener( 'input', () => {
			search = searchInput.value;
			draw();
			document.getElementById( 'v-search' ).focus();
			document.getElementById( 'v-search' ).setSelectionRange( search.length, search.length );
		} );

		main.querySelectorAll( '[data-add]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => addToCart( btn.dataset.add ) );
		} );
		main.querySelectorAll( '[data-cart]' ).forEach( ( row ) => {
			const variantId = row.dataset.cart;
			row.querySelector( '.c-plus' ).addEventListener( 'click', () => changeQty( variantId, 1 ) );
			row.querySelector( '.c-minus' ).addEventListener( 'click', () => changeQty( variantId, -1 ) );
			row.querySelector( '.c-remove' ).addEventListener( 'click', () => removeFromCart( variantId ) );
		} );

		const submitBtn = document.getElementById( 'v-submit' );
		if ( submitBtn ) {
			submitBtn.addEventListener( 'click', handleSubmit );
		}

		main.querySelectorAll( '.v-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', async () => {
				range = btn.dataset.range;
				await loadSales();
				draw();
			} );
		} );
	}

	function addToCart( variantId ) {
		const v = variants.find( ( x ) => x.id === variantId );
		if ( ! v ) return;
		const existing = cart.find( ( c ) => c.variantId === variantId );
		if ( existing ) {
			if ( existing.qty < v.stock_quantity ) existing.qty += 1;
		} else {
			cart.push( { variantId: v.id, name: v.products.name, size: v.size, color: v.color, price: v.price, stock: v.stock_quantity, qty: 1 } );
		}
		errorMsg = '';
		successMsg = '';
		draw();
	}

	function changeQty( variantId, delta ) {
		const item = cart.find( ( c ) => c.variantId === variantId );
		if ( ! item ) return;
		item.qty = Math.max( 1, Math.min( item.stock, item.qty + delta ) );
		draw();
	}

	function removeFromCart( variantId ) {
		cart = cart.filter( ( c ) => c.variantId !== variantId );
		draw();
	}

	async function handleSubmit() {
		if ( 0 === cart.length ) return;

		// Hay que leer el input ANTES de volver a dibujar — draw() reconstruye
		// el campo de Cliente desde cero (sin recordar lo tecleado), así que
		// si se lee después, siempre llega vacío.
		const customerName = document.getElementById( 'v-customer' )?.value.trim() || '';
		const items = cart.map( ( c ) => ( { variant_id: c.variantId, quantity: c.qty } ) );

		saving = true;
		errorMsg = '';
		successMsg = '';
		draw();

		const { error } = await supabase.rpc( 'register_sale', {
			p_organization_id: org.id,
			p_customer_name: customerName,
			p_items: items,
		} );

		saving = false;

		if ( error ) {
			errorMsg = 'No se pudo registrar la venta: ' + error.message;
			draw();
			return;
		}

		cart = [];
		successMsg = 'Venta registrada.';
		await Promise.all( [ loadVariants(), loadSales() ] );
		draw();
	}
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function formatSaleDateTime( isoString ) {
	const d = new Date( isoString );
	const date = d.toLocaleDateString( 'es-CL', { day: '2-digit', month: '2-digit' } );
	const time = d.toLocaleTimeString( 'es-CL', { hour: '2-digit', minute: '2-digit' } );
	return `${ date } ${ time }`;
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}

function escAttr( val ) {
	return esc( String( val ?? '' ) );
}
