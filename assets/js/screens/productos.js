const CATEGORIES = [ 'Poleras/Camisetas', 'Shorts', 'Pantalones/Joggers', 'Zapatillas', 'Accesorios' ];

export function renderProductos( main, ctx ) {
	const { supabase, org, isAdmin } = ctx;
	let view = 'list';
	let products = [];
	let editingProduct = null; // null = nuevo, objeto = editando
	let formVariants = [];
	let saving = false;
	let errorMsg = '';

	load();

	async function load() {
		main.innerHTML = loadingHtml();
		const { data, error } = await supabase
			.from( 'products' )
			.select( 'id, name, category, description, active, product_variants ( id, size, color, sku, price, cost, stock_quantity )' )
			.eq( 'organization_id', org.id )
			.order( 'created_at', { ascending: false } );

		if ( error ) {
			main.innerHTML = `<div class="acp-error">No se pudo cargar productos: ${ esc( error.message ) }</div>`;
			return;
		}
		products = data || [];
		draw();
	}

	function draw() {
		if ( 'form' === view ) {
			drawForm();
		} else {
			drawList();
		}
	}

	function drawList() {
		main.innerHTML = `
			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Productos</div>
				${ isAdmin ? '<button type="button" class="acp-btn-primary" style="width:auto;padding:10px 18px" id="acp-new-product">+ Nuevo producto</button>' : '' }
			</div>
			${ 0 === products.length ? '<div class="acp-empty-state">Todavía no hay productos cargados.</div>' : '' }
			<div style="display:flex;flex-direction:column;gap:12px">
				${ products.map( productCardHtml ).join( '' ) }
			</div>
		`;

		const newBtn = document.getElementById( 'acp-new-product' );
		if ( newBtn ) {
			newBtn.addEventListener( 'click', () => openForm( null ) );
		}
		main.querySelectorAll( '[data-edit]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const product = products.find( ( p ) => p.id === btn.dataset.edit );
				openForm( product );
			} );
		} );
	}

	function productCardHtml( product ) {
		const variants = product.product_variants || [];
		const totalStock = variants.reduce( ( sum, v ) => sum + v.stock_quantity, 0 );
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px">
				<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
					<div style="font-size:15px;font-weight:700">${ esc( product.name ) }</div>
					${ isAdmin ? `<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 14px" data-edit="${ product.id }">Editar</button>` : '' }
				</div>
				<div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">${ esc( product.category ) } · ${ totalStock } en stock</div>
				<div style="display:flex;flex-direction:column;gap:6px">
					${ variants
						.map(
							( v ) => `
						<div style="display:flex;align-items:center;gap:12px;font-size:13px;padding:6px 0;border-top:1px solid var(--border)">
							<div style="flex:1">${ esc( v.size ) }${ v.color ? ' · ' + esc( v.color ) : '' }</div>
							<div style="color:var(--text-muted)">Costo ${ money( v.cost ) }</div>
							<div style="font-weight:700">Precio ${ money( v.price ) }</div>
							<div style="color:var(--text-muted);width:70px;text-align:right">Stock ${ v.stock_quantity }</div>
						</div>
					`
						)
						.join( '' ) }
				</div>
			</div>
		`;
	}

	function openForm( product ) {
		editingProduct = product;
		formVariants = product
			? product.product_variants.map( ( v ) => ( { ...v } ) )
			: [ emptyVariant() ];
		errorMsg = '';
		view = 'form';
		draw();
	}

	function emptyVariant() {
		return { id: null, size: '', color: '', price: '', cost: '', stock_quantity: '' };
	}

	function drawForm() {
		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">${ editingProduct ? 'Editar producto' : 'Nuevo producto' }</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:720px">
				<div class="acp-field">
					<label>Nombre</label>
					<input id="p-name" value="${ escAttr( editingProduct?.name || '' ) }" />
				</div>
				<div class="acp-field" style="position:relative">
					<label>Categoría</label>
					<input id="p-category" autocomplete="off" placeholder="Elige una o escribe una nueva" value="${ escAttr( editingProduct?.category || '' ) }" />
					<div id="p-category-suggestions" class="acp-suggestions" style="display:none"></div>
				</div>
				<div class="acp-field">
					<label>Descripción (opcional)</label>
					<input id="p-description" value="${ escAttr( editingProduct?.description || '' ) }" />
				</div>

				<div style="font-size:13px;font-weight:700;margin:20px 0 10px">Variantes (talla / color)</div>
				<div id="p-variants"></div>
				<button type="button" class="acp-btn-secondary" style="width:auto;padding:8px 14px;margin-top:6px" id="p-add-variant">+ Agregar variante</button>

				<div style="display:flex;gap:10px;margin-top:24px">
					<button type="button" class="acp-btn-primary" style="width:auto;padding:12px 22px" id="p-save" ${ saving ? 'disabled' : '' }>${ saving ? 'Guardando…' : 'Guardar' }</button>
					<button type="button" class="acp-btn-secondary" style="width:auto;padding:12px 22px" id="p-cancel">Cancelar</button>
				</div>
			</div>
		`;

		drawVariantRows();
		wireCategoryField();

		document.getElementById( 'p-add-variant' ).addEventListener( 'click', () => {
			formVariants.push( emptyVariant() );
			drawVariantRows();
		} );
		document.getElementById( 'p-cancel' ).addEventListener( 'click', () => {
			view = 'list';
			draw();
		} );
		document.getElementById( 'p-save' ).addEventListener( 'click', handleSave );
	}

	function wireCategoryField() {
		const input = document.getElementById( 'p-category' );
		const list = document.getElementById( 'p-category-suggestions' );

		function showSuggestions() {
			const q = input.value.trim().toLowerCase();
			const matches = CATEGORIES.filter( ( c ) => '' === q || c.toLowerCase().includes( q ) );
			if ( 0 === matches.length ) {
				list.style.display = 'none';
				return;
			}
			list.innerHTML = matches
				.map( ( c ) => `<div class="acp-suggestion-item" data-value="${ escAttr( c ) }">${ esc( c ) }</div>` )
				.join( '' );
			list.style.display = 'block';
			list.querySelectorAll( '[data-value]' ).forEach( ( item ) => {
				// mousedown (not click) fires before the input's blur, so the
				// value gets set before the list disappears.
				item.addEventListener( 'mousedown', ( e ) => {
					e.preventDefault();
					input.value = item.dataset.value;
					list.style.display = 'none';
				} );
			} );
		}

		input.addEventListener( 'focus', showSuggestions );
		input.addEventListener( 'input', showSuggestions );
		input.addEventListener( 'blur', () => {
			list.style.display = 'none';
		} );
	}

	function drawVariantRows() {
		const wrap = document.getElementById( 'p-variants' );
		wrap.innerHTML = formVariants
			.map(
				( v, i ) => `
			<div style="display:grid;grid-template-columns:repeat(5, minmax(0, 1fr)) auto;gap:8px;margin-bottom:8px;align-items:center" data-row="${ i }">
				<input placeholder="Talla" class="v-size" value="${ escAttr( v.size ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				<input placeholder="Color" class="v-color" value="${ escAttr( v.color || '' ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				<input placeholder="Costo" class="v-cost" type="number" step="0.01" value="${ escAttr( v.cost ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				<input placeholder="Precio" class="v-price" type="number" step="0.01" value="${ escAttr( v.price ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				<input placeholder="Stock" class="v-stock" type="number" value="${ escAttr( v.stock_quantity ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:9px 10px;color:var(--text);font-size:13px;font-family:inherit" />
				<button type="button" class="v-remove" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:18px;padding:4px">&times;</button>
			</div>
		`
			)
			.join( '' );

		wrap.querySelectorAll( '.v-remove' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const i = Number( btn.closest( '[data-row]' ).dataset.row );
				formVariants.splice( i, 1 );
				if ( 0 === formVariants.length ) {
					formVariants.push( emptyVariant() );
				}
				drawVariantRows();
			} );
		} );
	}

	function readVariantsFromDom() {
		const rows = document.querySelectorAll( '#p-variants [data-row]' );
		return Array.from( rows ).map( ( row, i ) => ( {
			id: formVariants[ i ].id,
			size: row.querySelector( '.v-size' ).value.trim(),
			color: row.querySelector( '.v-color' ).value.trim() || null,
			cost: parseFloat( row.querySelector( '.v-cost' ).value ) || 0,
			price: parseFloat( row.querySelector( '.v-price' ).value ) || 0,
			stock_quantity: parseInt( row.querySelector( '.v-stock' ).value, 10 ) || 0,
		} ) );
	}

	async function handleSave() {
		const name = document.getElementById( 'p-name' ).value.trim();
		const category = document.getElementById( 'p-category' ).value;
		const description = document.getElementById( 'p-description' ).value.trim();
		const variants = readVariantsFromDom();

		if ( '' === name ) {
			errorMsg = 'El nombre es obligatorio.';
			draw();
			return;
		}
		if ( variants.some( ( v ) => '' === v.size ) ) {
			errorMsg = 'Todas las variantes necesitan una talla.';
			draw();
			return;
		}

		saving = true;
		draw();

		try {
			let productId = editingProduct?.id;

			if ( productId ) {
				const { error } = await supabase
					.from( 'products' )
					.update( { name, category, description: description || null } )
					.eq( 'id', productId );
				if ( error ) throw error;
			} else {
				const { data, error } = await supabase
					.from( 'products' )
					.insert( { organization_id: org.id, name, category, description: description || null } )
					.select( 'id' )
					.single();
				if ( error ) throw error;
				productId = data.id;
			}

			const originalIds = ( editingProduct?.product_variants || [] ).map( ( v ) => v.id );
			const keptIds = variants.filter( ( v ) => v.id ).map( ( v ) => v.id );
			const removedIds = originalIds.filter( ( id ) => ! keptIds.includes( id ) );

			if ( removedIds.length > 0 ) {
				const { error } = await supabase.from( 'product_variants' ).delete().in( 'id', removedIds );
				if ( error ) throw error;
			}

			const toUpdate = variants.filter( ( v ) => v.id );
			for ( const v of toUpdate ) {
				const { error } = await supabase
					.from( 'product_variants' )
					.update( { size: v.size, color: v.color, cost: v.cost, price: v.price, stock_quantity: v.stock_quantity } )
					.eq( 'id', v.id );
				if ( error ) throw error;
			}

			const toInsert = variants
				.filter( ( v ) => ! v.id )
				.map( ( v ) => ( {
					product_id: productId,
					organization_id: org.id,
					size: v.size,
					color: v.color,
					cost: v.cost,
					price: v.price,
					stock_quantity: v.stock_quantity,
				} ) );
			if ( toInsert.length > 0 ) {
				const { error } = await supabase.from( 'product_variants' ).insert( toInsert );
				if ( error ) throw error;
			}

			saving = false;
			view = 'list';
			await load();
		} catch ( err ) {
			saving = false;
			errorMsg = 'No se pudo guardar: ' + err.message;
			draw();
		}
	}
}

function loadingHtml() {
	return '<div class="acp-empty-state">Cargando…</div>';
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}

function escAttr( val ) {
	return esc( String( val ?? '' ) );
}
