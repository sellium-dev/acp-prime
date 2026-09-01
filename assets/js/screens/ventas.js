const SALE_STATUS = {
	pre_venta: { label: 'Pre-venta', color: 'oklch(0.72 0.13 230)' },
	credito: { label: 'Crédito', color: 'oklch(0.75 0.16 95)' },
	pagado: { label: 'Pagado', color: 'oklch(0.72 0.16 152)' },
	anulado: { label: 'Anulado', color: 'oklch(0.65 0.18 25)' },
};

export function renderVentas( main, ctx ) {
	const { supabase, org, membership } = ctx;
	let variants = [];
	let search = '';
	let cart = []; // { variantId, name, size, color, price, stock, qty }
	let saleStatus = 'pagado'; // estado con el que se registra la próxima venta
	let saving = false;
	let errorMsg = '';
	let successMsg = '';
	let sales = [];
	let memberNames = new Map();
	let range = [ 'mes', 'todos' ].includes( ctx.navParams?.range ) ? ctx.navParams.range : 'hoy';
	let statusFilter = ctx.navParams?.status && SALE_STATUS[ ctx.navParams.status ] ? ctx.navParams.status : null;

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

		let salesQuery = supabase
			.from( 'sales' )
			.select( 'id, customer_name, total_amount, created_at, vendor_id, status, sale_items ( quantity )' )
			.eq( 'organization_id', org.id )
			.order( 'created_at', { ascending: false } );
		if ( 'todos' !== range ) {
			salesQuery = salesQuery.gte( 'created_at', cutoff.toISOString() );
		}

		const [ salesRes, membersRes ] = await Promise.all( [
			salesQuery,
			supabase.from( 'memberships' ).select( 'user_id, full_name' ).eq( 'organization_id', org.id ),
		] );

		sales = salesRes.data || [];
		memberNames = new Map( ( membersRes.data || [] ).map( ( m ) => [ m.user_id, m.full_name ] ) );
	}

	function draw() {
		const filtered = filterVariants();
		const cartTotal = cart.reduce( ( sum, item ) => sum + item.price * item.qty, 0 );
		const filteredSales = statusFilter ? sales.filter( ( s ) => s.status === statusFilter ) : sales;

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
					<div class="acp-field">
						<label>Estado</label>
						<select id="v-status" style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;color:var(--text);font-size:14px;font-family:inherit">
							<option value="pagado" ${ 'pagado' === saleStatus ? 'selected' : '' }>Pagado</option>
							<option value="pre_venta" ${ 'pre_venta' === saleStatus ? 'selected' : '' }>Pre-venta</option>
							<option value="credito" ${ 'credito' === saleStatus ? 'selected' : '' }>Crédito</option>
						</select>
						${
							'pagado' !== saleStatus
								? '<div style="font-size:11px;color:var(--text-muted);margin-top:4px">Descuenta el stock igual, pero no cuenta como venta en el Dashboard hasta que la marques como Pagado.</div>'
								: ''
						}
					</div>
					<div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800;margin:14px 0">
						<span>Total</span><span id="v-cart-total">${ money( cartTotal ) }</span>
					</div>
					<button type="button" class="acp-btn-primary" id="v-submit" ${ saving || 0 === cart.length ? 'disabled' : '' }>
						${ saving ? 'Registrando…' : 'Registrar venta' }
					</button>
				</div>
			</div>

			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
				<div style="font-size:15px;font-weight:700">Ventas</div>
				<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
					<button type="button" class="v-range-btn" data-range="hoy" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'hoy' === range ? 'var(--accent)' : 'transparent' };color:${ 'hoy' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Hoy</button>
					<button type="button" class="v-range-btn" data-range="mes" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'mes' === range ? 'var(--accent)' : 'transparent' };color:${ 'mes' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Este mes</button>
					<button type="button" class="v-range-btn" data-range="todos" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'todos' === range ? 'var(--accent)' : 'transparent' };color:${ 'todos' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Todos</button>
				</div>
			</div>
			${
				statusFilter
					? `
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12px;color:var(--text-muted)">
					Mostrando solo: <span style="font-weight:700;color:${ SALE_STATUS[ statusFilter ].color }">${ SALE_STATUS[ statusFilter ].label }</span>
					<button type="button" id="v-clear-status-filter" style="background:none;border:none;color:var(--text-muted);cursor:pointer;text-decoration:underline;font-size:12px">Quitar filtro</button>
				</div>
			`
					: ''
			}
			${ 0 === filteredSales.length ? '<div class="acp-empty-state">No hay ventas en este rango.</div>' : salesTableHtml( filteredSales ) }
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
			<div style="border:1px solid var(--border);border-radius:10px;padding:10px" data-cart="${ item.variantId }">
				<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
					<div style="flex:1;min-width:0">
						<div style="font-weight:600;font-size:13px">${ esc( item.name ) }</div>
						<div style="color:var(--text-muted);font-size:12px">${ esc( item.size ) }${ item.color ? ' · ' + esc( item.color ) : '' }</div>
					</div>
					<button type="button" class="c-remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;width:36px;height:36px;flex:0 0 auto">&times;</button>
				</div>
				<div style="display:flex;align-items:center;gap:8px">
					<button type="button" class="c-minus" style="background:var(--btn-secondary-bg);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:6px;cursor:pointer;font-size:16px;flex:0 0 auto">−</button>
					<div style="width:22px;text-align:center;font-size:13px">${ item.qty }</div>
					<button type="button" class="c-plus" style="background:var(--btn-secondary-bg);border:1px solid var(--border);color:var(--text);width:36px;height:36px;border-radius:6px;cursor:pointer;font-size:16px;flex:0 0 auto">+</button>
					<input class="c-price" type="number" min="0" step="1" value="${ escAttr( item.price ) }"
						style="flex:1;min-width:0;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;color:var(--text);font-size:13px;font-family:inherit" />
					<div class="c-subtotal" style="width:74px;text-align:right;font-weight:700;font-size:13px;flex:0 0 auto">${ money( item.price * item.qty ) }</div>
				</div>
				${
					item.price !== item.catalogPrice
						? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Precio de lista: ${ money( item.catalogPrice ) }</div>`
						: ''
				}
			</div>
		`;
	}

	function salesTableHtml( rows ) {
		const cols = 'minmax(0,1.1fr) minmax(0,1.1fr) minmax(0,1fr) minmax(0,0.6fr) minmax(0,0.8fr) minmax(0,0.9fr)';
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
				<div style="display:grid;grid-template-columns:${ cols };gap:12px;padding:12px 18px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
					<div>Fecha</div><div>Vendedor</div><div>Cliente</div><div>Ítems</div><div>Total</div><div>Estado</div>
				</div>
				${ rows
					.map( ( s ) => {
						const status = SALE_STATUS[ s.status ] || SALE_STATUS.pagado;
						const pending = 'pre_venta' === s.status || 'credito' === s.status;
						const voidable = 'anulado' !== s.status;
						return `
					<div style="padding:12px 18px;border-bottom:1px solid var(--border)">
						<div style="display:grid;grid-template-columns:${ cols };gap:12px;font-size:13px;align-items:center">
							<div>${ formatSaleDateTime( s.created_at ) }</div>
							<div>${ esc( memberNames.get( s.vendor_id ) || '—' ) }</div>
							<div style="color:var(--text-muted)">${ esc( s.customer_name || '—' ) }</div>
							<div>${ s.sale_items.reduce( ( n, it ) => n + it.quantity, 0 ) }</div>
							<div style="font-weight:700">${ money( s.total_amount ) }</div>
							<div style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:20px;background:${ status.color.replace( ')', ' / 0.15)' ) };color:${ status.color };width:fit-content">${ status.label }</div>
						</div>
						${
							pending || voidable
								? `
							<div style="display:flex;gap:8px;margin-top:10px">
								${ pending ? `<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 12px;font-size:12px" data-mark-paid="${ s.id }">Marcar pagado</button>` : '' }
								${ voidable ? `<button type="button" style="background:none;border:none;color:oklch(0.65 0.18 25);cursor:pointer;font-size:12px" data-void="${ s.id }">Anular</button>` : '' }
							</div>
						`
								: ''
						}
					</div>
				`;
					} )
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

		// Delegado y sin volver a dibujar todo — si hiciéramos draw() en cada
		// tecla se pierde el foco del input a mitad de escribir el precio.
		// Solo se actualiza el subtotal de esa fila y el total general; el
		// array `cart` (fuente de verdad real) ya queda al día para cuando
		// se guarde o se redibuje por otra razón (+/-, quitar, etc).
		main.addEventListener( 'input', ( e ) => {
			if ( ! e.target.matches( '.c-price' ) ) return;
			const row = e.target.closest( '[data-cart]' );
			const item = cart.find( ( c ) => c.variantId === row.dataset.cart );
			if ( ! item ) return;
			item.price = parseFloat( e.target.value ) || 0;
			row.querySelector( '.c-subtotal' ).textContent = money( item.price * item.qty );
			const totalEl = document.getElementById( 'v-cart-total' );
			if ( totalEl ) totalEl.textContent = money( cart.reduce( ( sum, c ) => sum + c.price * c.qty, 0 ) );
		} );

		const submitBtn = document.getElementById( 'v-submit' );
		if ( submitBtn ) {
			submitBtn.addEventListener( 'click', handleSubmit );
		}

		const statusSelect = document.getElementById( 'v-status' );
		if ( statusSelect ) {
			statusSelect.addEventListener( 'change', () => {
				saleStatus = statusSelect.value;
				draw();
			} );
		}

		main.querySelectorAll( '[data-mark-paid]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleMarkPaid( btn.dataset.markPaid ) );
		} );
		main.querySelectorAll( '[data-void]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleVoidSale( btn.dataset.void ) );
		} );

		main.querySelectorAll( '.v-range-btn' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', async () => {
				range = btn.dataset.range;
				statusFilter = null;
				await loadSales();
				draw();
			} );
		} );

		const clearFilterBtn = document.getElementById( 'v-clear-status-filter' );
		if ( clearFilterBtn ) {
			clearFilterBtn.addEventListener( 'click', () => {
				statusFilter = null;
				draw();
			} );
		}
	}

	function addToCart( variantId ) {
		const v = variants.find( ( x ) => x.id === variantId );
		if ( ! v ) return;
		const existing = cart.find( ( c ) => c.variantId === variantId );
		if ( existing ) {
			if ( existing.qty < v.stock_quantity ) existing.qty += 1;
		} else {
			cart.push( { variantId: v.id, name: v.products.name, size: v.size, color: v.color, price: v.price, catalogPrice: v.price, stock: v.stock_quantity, qty: 1 } );
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

		if ( cart.some( ( c ) => ! Number.isFinite( c.price ) || c.price < 0 ) ) {
			errorMsg = 'El precio de cada producto debe ser un número igual o mayor a 0.';
			draw();
			return;
		}

		const items = cart.map( ( c ) => ( { variant_id: c.variantId, quantity: c.qty, unit_price: c.price } ) );

		saving = true;
		errorMsg = '';
		successMsg = '';
		draw();

		const { error } = await supabase.rpc( 'register_sale', {
			p_organization_id: org.id,
			p_customer_name: customerName,
			p_items: items,
			p_status: saleStatus,
		} );

		saving = false;

		if ( error ) {
			errorMsg = 'No se pudo registrar la venta: ' + error.message;
			draw();
			return;
		}

		cart = [];
		saleStatus = 'pagado';
		successMsg = 'Venta registrada.';
		await Promise.all( [ loadVariants(), loadSales() ] );
		draw();
	}

	async function handleMarkPaid( saleId ) {
		errorMsg = '';
		successMsg = '';
		const { error } = await supabase.rpc( 'mark_sale_paid', { p_sale_id: saleId } );
		if ( error ) {
			errorMsg = 'No se pudo marcar como pagada: ' + error.message;
			draw();
			return;
		}
		successMsg = 'Venta marcada como pagada.';
		await loadSales();
		draw();
	}

	async function handleVoidSale( saleId ) {
		if ( ! window.confirm( 'Esto anula la venta y devuelve el stock. ¿Confirmas?' ) ) return;

		errorMsg = '';
		successMsg = '';
		const { error } = await supabase.rpc( 'void_sale', { p_sale_id: saleId } );
		if ( error ) {
			errorMsg = 'No se pudo anular la venta: ' + error.message;
			draw();
			return;
		}
		successMsg = 'Venta anulada — el stock fue devuelto.';
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
